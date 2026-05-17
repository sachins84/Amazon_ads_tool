/**
 * Deterministic optimization engine.
 *
 * Inputs:
 *   - Entity (campaign / ad-group / keyword) with 1d/3d/7d metric windows
 *   - Objective (target ROAS + scale-bound caps)
 *
 * Output:
 *   - Bucket: SCALE_UP | SCALE_DOWN | PAUSE | BID_UP | BID_DOWN | HOLD
 *   - Suggested action with bounded value
 *   - Reason string explaining the call
 *   - Confidence 0..1
 *   - Signals snapshot (so the UI + audit log can show what the engine saw)
 *
 * Pure function: no I/O, no DB, deterministic for any given input. Safe to
 * unit-test against synthetic rows; the runner wraps it with data fetch + DB writes.
 */

export type Bucket = "SCALE_UP" | "SCALE_DOWN" | "PAUSE" | "BID_UP" | "BID_DOWN" | "HOLD";

export interface OptimizerObjective {
  targetRoas: number;             // e.g. 2.5 — the floor ROAS we want to maintain
  maxScaleUpPct: number;          // cap on budget/bid increase (e.g. 20 → max +20%)
  maxScaleDownPct: number;        // cap on budget/bid decrease
  minSpendThreshold: number;      // ignore entities below this 7d spend (statistical noise)
  pauseWhenOrdersZeroDays: number;// pause if no orders for N consecutive days
}

export interface WindowMetrics {
  spend: number; sales: number; orders: number;
  impressions: number; clicks: number;
  topOfSearchIS?: number | null;   // 0..100 percent; null if unavailable
}

export interface OptimizerEntity {
  id: string;
  name: string;
  type: "CAMPAIGN" | "AD_GROUP" | "KEYWORD" | "PRODUCT_TARGET";
  program?: "SP" | "SB" | "SD";
  campaignId?: string;
  adGroupId?: string;
  state: "ENABLED" | "PAUSED" | "ARCHIVED";
  currentValue: number;            // budget for campaigns, bid for ad groups/keywords
  /** Daily metric windows, mostly cumulative over the window. */
  m1d: WindowMetrics;
  m3d: WindowMetrics;
  m7d: WindowMetrics;
  /** Account-wide benchmark values for context (computed once by the runner). */
  benchmark?: {
    avgCpc?: number;
    avgRoas?: number;
  };
}

export interface OptimizerSignals {
  roas1d: number; roas3d: number; roas7d: number;
  acos7d: number;
  ordersTrend7vs3: "up" | "down" | "flat";   // are orders accelerating?
  roasTrend7vs3:   "up" | "down" | "flat";
  cpc7d: number;
  ctr7d: number;
  topOfSearchIS7d: number | null;
  zeroOrderDays: number;             // consecutive 0-order days (0 if last day had orders)
  vsBenchmarkCpc: number | null;     // %% above (positive) or below the account avg
}

export interface OptimizerSuggestion {
  bucket: Bucket;
  actionType: "PAUSE" | "ENABLE" | "SET_BID" | "BID_PCT" | "SET_BUDGET" | "BUDGET_PCT" | "ADD_NEGATIVE";
  actionValue: number | null;       // new bid/budget for SET_*, percent for *_PCT
  reason: string;                   // human-readable why
  confidence: number;               // 0..1
  signals: OptimizerSignals;        // full signal snapshot for audit
}

// ─── Engine ─────────────────────────────────────────────────────────────────

export function evaluateEntity(e: OptimizerEntity, obj: OptimizerObjective): OptimizerSuggestion {
  const signals = computeSignals(e);
  const { roas1d, roas3d, roas7d, ordersTrend7vs3, roasTrend7vs3,
          zeroOrderDays, topOfSearchIS7d, vsBenchmarkCpc, cpc7d } = signals;

  const spend7 = e.m7d.spend;
  const orders7 = e.m7d.orders;
  const clicks7 = e.m7d.clicks;
  const target  = obj.targetRoas;

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

  // ── 3. Strong loser → SCALE_DOWN or BID_DOWN ──
  // ROAS < 0.5× target for 7 days, also failing on 3d, ALL with real spend
  if (roas7d < target * 0.5 && roas3d < target * 0.6 && spend7 >= obj.minSpendThreshold * 2) {
    // For keywords/targets: drop the bid. For campaigns/ad-groups: shrink budget.
    const isBidLevel = e.type === "KEYWORD" || e.type === "PRODUCT_TARGET";
    const cap = -Math.abs(obj.maxScaleDownPct);
    const dropPct = Math.max(cap, percentDelta(roas7d, target) * 0.6);  // proportional, capped
    const newVal = clampDelta(e.currentValue, dropPct);
    return {
      bucket: isBidLevel ? "BID_DOWN" : "SCALE_DOWN",
      actionType: isBidLevel ? "SET_BID" : "SET_BUDGET",
      actionValue: round2(newVal),
      reason: `ROAS ${roas7d.toFixed(2)}x is below ${target.toFixed(2)}x target (7d=${roas7d.toFixed(2)}x, 3d=${roas3d.toFixed(2)}x). Cut ${isBidLevel ? "bid" : "budget"} ${pctLabel(dropPct)}.`,
      confidence: 0.75, signals,
    };
  }

  // ── 4. Strong winner with headroom → SCALE_UP ──
  // ROAS >= 1.2× target, trend not falling, AND either:
  //   - impression share has room (< 60%) → spend more to capture more
  //   - orders trending up → momentum
  if (roas7d >= target * 1.2 && roasTrend7vs3 !== "down") {
    const hasIsHeadroom = topOfSearchIS7d != null && topOfSearchIS7d < 60;
    const momentum      = ordersTrend7vs3 === "up";
    if (hasIsHeadroom || momentum) {
      const isBidLevel = e.type === "KEYWORD" || e.type === "PRODUCT_TARGET";
      const cap = obj.maxScaleUpPct;
      // The further above target, the more we lean in — but capped.
      const aggressionPct = Math.min(cap, percentDelta(roas7d, target) * 0.4 + (momentum ? 5 : 0));
      const newVal = clampDelta(e.currentValue, aggressionPct);
      const why = [
        `ROAS ${roas7d.toFixed(2)}x ≥ ${(target * 1.2).toFixed(2)}x (target × 1.2)`,
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

  // ── 5. Moderate loser → small BID_DOWN / SCALE_DOWN ──
  if (roas7d < target * 0.85 && spend7 >= obj.minSpendThreshold * 1.5) {
    const isBidLevel = e.type === "KEYWORD" || e.type === "PRODUCT_TARGET";
    const dropPct = Math.max(-obj.maxScaleDownPct, percentDelta(roas7d, target) * 0.3);
    const newVal = clampDelta(e.currentValue, dropPct);
    return {
      bucket: isBidLevel ? "BID_DOWN" : "SCALE_DOWN",
      actionType: isBidLevel ? "SET_BID" : "SET_BUDGET",
      actionValue: round2(newVal),
      reason: `ROAS ${roas7d.toFixed(2)}x below target ${target.toFixed(2)}x. Trim ${isBidLevel ? "bid" : "budget"} ${pctLabel(dropPct)} to improve efficiency.`,
      confidence: 0.55, signals,
    };
  }

  // ── 6. Overpaying for clicks → BID_DOWN (keywords only) ──
  if ((e.type === "KEYWORD" || e.type === "PRODUCT_TARGET")
      && vsBenchmarkCpc != null && vsBenchmarkCpc > 50
      && orders7 < 3 && clicks7 > 10) {
    const dropPct = Math.max(-obj.maxScaleDownPct, -15);
    const newVal  = clampDelta(e.currentValue, dropPct);
    return {
      bucket: "BID_DOWN", actionType: "SET_BID", actionValue: round2(newVal),
      reason: `CPC ${cpc7d.toFixed(2)} is ${vsBenchmarkCpc.toFixed(0)}% above account avg with only ${orders7} order(s) on ${clicks7} clicks. Lower bid ${pctLabel(dropPct)}.`,
      confidence: 0.6, signals,
    };
  }

  // ── 7. Default → HOLD ──
  return {
    bucket: "HOLD", actionType: "ENABLE", actionValue: null,
    reason: `ROAS ${roas7d.toFixed(2)}x is near target ${target.toFixed(2)}x. No change recommended.`,
    confidence: 0.5, signals,
  };
}

// ─── Signal computation ─────────────────────────────────────────────────────

function computeSignals(e: OptimizerEntity): OptimizerSignals {
  const roas1d = safeRoas(e.m1d);
  const roas3d = safeRoas(e.m3d);
  const roas7d = safeRoas(e.m7d);

  // Trend: compare last 3d to the EARLIER 4d (i.e. day-7 through day-4)
  // We don't have those rolled separately; approximate via 7d-vs-3d ratio.
  const ordersEarlier  = Math.max(0, e.m7d.orders - e.m3d.orders);   // days 4-7
  const ordersRecent3d = e.m3d.orders;
  const salesEarlier   = Math.max(0, e.m7d.sales - e.m3d.sales);
  const spendEarlier   = Math.max(0, e.m7d.spend - e.m3d.spend);
  const roasEarlier    = spendEarlier > 0 ? salesEarlier / spendEarlier : 0;

  const cpc7d = e.m7d.clicks > 0 ? e.m7d.spend / e.m7d.clicks : 0;
  const ctr7d = e.m7d.impressions > 0 ? (e.m7d.clicks / e.m7d.impressions) * 100 : 0;
  const acos7d = e.m7d.sales > 0 ? (e.m7d.spend / e.m7d.sales) * 100 : 0;

  const vsBenchmarkCpc = e.benchmark?.avgCpc && e.benchmark.avgCpc > 0
    ? ((cpc7d - e.benchmark.avgCpc) / e.benchmark.avgCpc) * 100
    : null;

  return {
    roas1d, roas3d, roas7d, acos7d,
    ordersTrend7vs3: classifyTrend(ordersRecent3d / 3, ordersEarlier / 4),
    roasTrend7vs3:   classifyTrend(roas3d, roasEarlier),
    cpc7d, ctr7d,
    topOfSearchIS7d: e.m7d.topOfSearchIS ?? null,
    zeroOrderDays:   e.m1d.orders === 0 && e.m3d.orders === 0 && e.m7d.orders === 0 ? 7 :
                     e.m1d.orders === 0 && e.m3d.orders === 0 ? 3 :
                     e.m1d.orders === 0 ? 1 : 0,
    vsBenchmarkCpc,
  };
}

function safeRoas(m: WindowMetrics): number {
  return m.spend > 0 ? m.sales / m.spend : 0;
}

function classifyTrend(now: number, before: number): "up" | "down" | "flat" {
  if (before === 0 && now === 0) return "flat";
  if (before === 0) return "up";
  const delta = (now - before) / before;
  if (delta > 0.1) return "up";
  if (delta < -0.1) return "down";
  return "flat";
}

function percentDelta(current: number, target: number): number {
  if (target === 0) return 0;
  return ((current - target) / target) * 100;
}

function clampDelta(value: number, pct: number): number {
  return Math.max(0.02, value * (1 + pct / 100));
}

function pctLabel(pct: number): string {
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(0)}%`;
}

function round2(n: number) { return Math.round(n * 100) / 100; }
function fmtMoney(n: number) { return n.toFixed(0); }
