/**
 * Deterministic optimization engine — ACOS edition.
 *
 * Inputs:
 *   - Entity (campaign / ad-group / keyword) with 1d/3d/7d metric windows
 *     and a per-entity targetAcos (resolved by the runner from the matrix)
 *   - Objective (caps + thresholds, plus a default ACOS used when the matrix
 *     has no rule for the entity's (program, intent) pair)
 *
 * Output:
 *   - Bucket: SCALE_UP | SCALE_DOWN | PAUSE | BID_UP | BID_DOWN | HOLD
 *   - Suggested action with bounded value
 *   - Reason string explaining the call
 *   - Confidence 0..1
 *   - Signals snapshot (so the UI + audit log can show what the engine saw)
 *
 * Convention: ACOS = spend/sales × 100 (percent). LOWER is better. A campaign
 * with acos 15% on a 25% target is a winner; 50% on the same target is a loser.
 * ACOS is null when sales = 0 — handled explicitly (zero-order branch first).
 *
 * Pure function: no I/O, no DB. Safe to unit-test against synthetic rows.
 */
import type { Intent } from "@/lib/amazon-api/intent";
import type { OptimizerProgram } from "@/lib/db/acos-targets-repo";

export type Bucket = "SCALE_UP" | "SCALE_DOWN" | "PAUSE" | "BID_UP" | "BID_DOWN" | "HOLD";

export interface OptimizerObjective {
  /** Account default target ACOS (percent). Used when the (program, intent)
   *  matrix has no specific rule. */
  defaultTargetAcos: number;
  maxScaleUpPct: number;
  maxScaleDownPct: number;
  minSpendThreshold: number;
  pauseWhenOrdersZeroDays: number;
}

export interface WindowMetrics {
  spend: number; sales: number; orders: number;
  impressions: number; clicks: number;
  topOfSearchIS?: number | null;
}

export interface OptimizerEntity {
  id: string;
  name: string;
  type: "CAMPAIGN" | "AD_GROUP" | "KEYWORD" | "PRODUCT_TARGET";
  /** Raw program from API (SP/SB/SD). */
  program?: "SP" | "SB" | "SD";
  /** Effective program for target lookup — distinguishes SB_VIDEO. */
  programKey?: OptimizerProgram;
  intent?: Intent;
  /** Resolved target ACOS for this entity (percent). Falls back to obj.defaultTargetAcos. */
  targetAcos?: number;
  campaignId?: string;
  adGroupId?: string;
  state: "ENABLED" | "PAUSED" | "ARCHIVED";
  currentValue: number;
  m1d: WindowMetrics;
  m3d: WindowMetrics;
  m7d: WindowMetrics;
  benchmark?: { avgCpc?: number };
}

export interface OptimizerSignals {
  acos1d: number | null; acos3d: number | null; acos7d: number | null;
  roas7d: number;                            // kept for downstream reporting (1/ACOS)
  ordersTrend7vs3: "up" | "down" | "flat";
  acosTrend7vs3:   "improving" | "worsening" | "flat";
  cpc7d: number;
  ctr7d: number;
  topOfSearchIS7d: number | null;
  zeroOrderDays: number;
  vsBenchmarkCpc: number | null;
  targetAcos: number;
}

export interface OptimizerSuggestion {
  bucket: Bucket;
  actionType: "PAUSE" | "ENABLE" | "SET_BID" | "BID_PCT" | "SET_BUDGET" | "BUDGET_PCT" | "ADD_NEGATIVE";
  actionValue: number | null;
  reason: string;
  confidence: number;
  signals: OptimizerSignals;
}

// ─── Engine ─────────────────────────────────────────────────────────────────

export function evaluateEntity(e: OptimizerEntity, obj: OptimizerObjective): OptimizerSuggestion {
  const target = effectiveTarget(e, obj);
  const signals = computeSignals(e, target);
  const { acos7d, acos3d, ordersTrend7vs3, acosTrend7vs3,
          zeroOrderDays, topOfSearchIS7d, vsBenchmarkCpc, cpc7d } = signals;

  const spend7 = e.m7d.spend;
  const orders7 = e.m7d.orders;
  const clicks7 = e.m7d.clicks;
  const isBidLevel = e.type === "KEYWORD" || e.type === "PRODUCT_TARGET";

  // ── 1. Long zero-order window → PAUSE (high-confidence kill) ──
  if (zeroOrderDays >= obj.pauseWhenOrdersZeroDays && spend7 >= obj.minSpendThreshold) {
    return {
      bucket: "PAUSE", actionType: "PAUSE", actionValue: null,
      reason: `${zeroOrderDays}+ days with 0 orders despite ${fmtMoney(spend7)} spend — pause to stop the bleed.`,
      confidence: 0.9, signals,
    };
  }

  // ── 2. Below min spend → HOLD (not enough signal) ──
  if (spend7 < obj.minSpendThreshold) {
    return {
      bucket: "HOLD", actionType: "ENABLE", actionValue: null,
      reason: `Spend ${fmtMoney(spend7)} below threshold ${fmtMoney(obj.minSpendThreshold)} — not enough signal yet.`,
      confidence: 0.3, signals,
    };
  }

  // ── 3. Spend-with-no-sales → catastrophic (different from zero-order: this
  // covers entities that bled spend for <pause_days but with no sales). ──
  if ((acos7d == null || acos7d === Infinity) && orders7 === 0 && spend7 >= obj.minSpendThreshold * 2) {
    return {
      bucket: "PAUSE", actionType: "PAUSE", actionValue: null,
      reason: `${fmtMoney(spend7)} spent on 0 sales over 7d. Pause and reallocate.`,
      confidence: 0.85, signals,
    };
  }

  // ── 4. ACOS way over target → SCALE_DOWN or BID_DOWN (strong loser) ──
  if (acos7d != null && acos7d > target * 1.5 && (acos3d == null || acos3d > target * 1.4)
      && spend7 >= obj.minSpendThreshold * 2) {
    const cap = -Math.abs(obj.maxScaleDownPct);
    // Excess proportional to how much above target — bigger cut for worse offenders.
    const excessPct = ((acos7d - target) / target) * 100;
    const dropPct = Math.max(cap, -Math.min(Math.abs(cap), excessPct * 0.5));
    const newVal = clampDelta(e.currentValue, dropPct);
    return {
      bucket: isBidLevel ? "BID_DOWN" : "SCALE_DOWN",
      actionType: isBidLevel ? "SET_BID" : "SET_BUDGET",
      actionValue: round2(newVal),
      reason: `ACOS ${fmtPct(acos7d)} is ${fmtPct(excessPct)} above target ${fmtPct(target)} (7d). Cut ${isBidLevel ? "bid" : "budget"} ${pctLabel(dropPct)}.`,
      confidence: 0.75, signals,
    };
  }

  // ── 5. Strong winner with headroom → SCALE_UP / BID_UP ──
  // ACOS ≤ 60% of target, trend not worsening, AND either impression-share has
  // room OR orders are accelerating.
  if (acos7d != null && acos7d <= target * 0.6 && acosTrend7vs3 !== "worsening") {
    const hasIsHeadroom = topOfSearchIS7d != null && topOfSearchIS7d < 60;
    const momentum      = ordersTrend7vs3 === "up";
    if (hasIsHeadroom || momentum) {
      const efficiencyPct = ((target - acos7d) / target) * 100; // positive = good
      const aggressionPct = Math.min(obj.maxScaleUpPct, efficiencyPct * 0.4 + (momentum ? 5 : 0));
      const newVal = clampDelta(e.currentValue, aggressionPct);
      const why = [
        `ACOS ${fmtPct(acos7d)} ≤ ${fmtPct(target * 0.6)} (target × 0.6)`,
        hasIsHeadroom ? `TOS impression-share ${topOfSearchIS7d!.toFixed(0)}% has headroom` : "",
        momentum ? "orders trending up" : "",
      ].filter(Boolean).join("; ");
      return {
        bucket: isBidLevel ? "BID_UP" : "SCALE_UP",
        actionType: isBidLevel ? "SET_BID" : "SET_BUDGET",
        actionValue: round2(newVal),
        reason: `${why}. Lean in ${pctLabel(aggressionPct)}.`,
        confidence: hasIsHeadroom && momentum ? 0.85 : 0.65,
        signals,
      };
    }
  }

  // ── 6. Moderate loser → small trim ──
  if (acos7d != null && acos7d > target * 1.15 && spend7 >= obj.minSpendThreshold * 1.5) {
    const excessPct = ((acos7d - target) / target) * 100;
    const dropPct = Math.max(-obj.maxScaleDownPct, -Math.min(obj.maxScaleDownPct, excessPct * 0.3));
    const newVal = clampDelta(e.currentValue, dropPct);
    return {
      bucket: isBidLevel ? "BID_DOWN" : "SCALE_DOWN",
      actionType: isBidLevel ? "SET_BID" : "SET_BUDGET",
      actionValue: round2(newVal),
      reason: `ACOS ${fmtPct(acos7d)} above target ${fmtPct(target)}. Trim ${isBidLevel ? "bid" : "budget"} ${pctLabel(dropPct)} to improve efficiency.`,
      confidence: 0.55, signals,
    };
  }

  // ── 7. Overpaying for clicks → BID_DOWN (keywords only) ──
  if (isBidLevel && vsBenchmarkCpc != null && vsBenchmarkCpc > 50
      && orders7 < 3 && clicks7 > 10) {
    const dropPct = Math.max(-obj.maxScaleDownPct, -15);
    const newVal  = clampDelta(e.currentValue, dropPct);
    return {
      bucket: "BID_DOWN", actionType: "SET_BID", actionValue: round2(newVal),
      reason: `CPC ${cpc7d.toFixed(2)} is ${vsBenchmarkCpc.toFixed(0)}% above account avg with only ${orders7} order(s) on ${clicks7} clicks. Lower bid ${pctLabel(dropPct)}.`,
      confidence: 0.6, signals,
    };
  }

  // ── 8. Default → HOLD ──
  return {
    bucket: "HOLD", actionType: "ENABLE", actionValue: null,
    reason: acos7d != null
      ? `ACOS ${fmtPct(acos7d)} is near target ${fmtPct(target)}. No change recommended.`
      : `Insufficient data over 7d. No change recommended.`,
    confidence: 0.5, signals,
  };
}

// ─── Signal computation ─────────────────────────────────────────────────────

export function effectiveTarget(e: OptimizerEntity, obj: OptimizerObjective): number {
  return (e.targetAcos != null && e.targetAcos > 0) ? e.targetAcos : obj.defaultTargetAcos;
}

function computeSignals(e: OptimizerEntity, target: number): OptimizerSignals {
  const acos1d = acosOf(e.m1d);
  const acos3d = acosOf(e.m3d);
  const acos7d = acosOf(e.m7d);

  // Trend over "early 4d" vs "recent 3d" (approx — 7d minus 3d = days 4-7).
  const ordersEarlier  = Math.max(0, e.m7d.orders - e.m3d.orders);
  const ordersRecent3d = e.m3d.orders;
  const spendEarlier   = Math.max(0, e.m7d.spend - e.m3d.spend);
  const salesEarlier   = Math.max(0, e.m7d.sales - e.m3d.sales);
  const acosEarlier    = salesEarlier > 0 ? (spendEarlier / salesEarlier) * 100 : null;

  const cpc7d = e.m7d.clicks > 0 ? e.m7d.spend / e.m7d.clicks : 0;
  const ctr7d = e.m7d.impressions > 0 ? (e.m7d.clicks / e.m7d.impressions) * 100 : 0;

  const vsBenchmarkCpc = e.benchmark?.avgCpc && e.benchmark.avgCpc > 0
    ? ((cpc7d - e.benchmark.avgCpc) / e.benchmark.avgCpc) * 100
    : null;

  return {
    acos1d, acos3d, acos7d,
    roas7d: e.m7d.spend > 0 ? e.m7d.sales / e.m7d.spend : 0,
    ordersTrend7vs3: classifyVolumeTrend(ordersRecent3d / 3, ordersEarlier / 4),
    acosTrend7vs3:   classifyAcosTrend(acos3d, acosEarlier),
    cpc7d, ctr7d,
    topOfSearchIS7d: e.m7d.topOfSearchIS ?? null,
    zeroOrderDays:   e.m1d.orders === 0 && e.m3d.orders === 0 && e.m7d.orders === 0 ? 7 :
                     e.m1d.orders === 0 && e.m3d.orders === 0 ? 3 :
                     e.m1d.orders === 0 ? 1 : 0,
    vsBenchmarkCpc,
    targetAcos: target,
  };
}

function acosOf(m: WindowMetrics): number | null {
  if (m.sales <= 0) return null;
  return (m.spend / m.sales) * 100;
}

function classifyVolumeTrend(now: number, before: number): "up" | "down" | "flat" {
  if (before === 0 && now === 0) return "flat";
  if (before === 0) return "up";
  const delta = (now - before) / before;
  if (delta > 0.1) return "up";
  if (delta < -0.1) return "down";
  return "flat";
}

/** For ACOS, "down" = improving (lower is better). Flip the labels for clarity. */
function classifyAcosTrend(now: number | null, before: number | null): "improving" | "worsening" | "flat" {
  if (now == null && before == null) return "flat";
  if (now == null) return "worsening";    // had sales, now has none
  if (before == null) return "improving"; // had no sales, now has some
  const delta = (now - before) / before;
  if (delta > 0.1)  return "worsening";
  if (delta < -0.1) return "improving";
  return "flat";
}

function clampDelta(value: number, pct: number): number {
  return Math.max(0.02, value * (1 + pct / 100));
}

function pctLabel(pct: number): string {
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(0)}%`;
}

function fmtPct(n: number): string { return `${n.toFixed(1)}%`; }
function round2(n: number) { return Math.round(n * 100) / 100; }
function fmtMoney(n: number) { return n.toFixed(0); }
