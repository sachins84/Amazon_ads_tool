/**
 * Optimizer runner.
 *
 * For a given account + objective:
 *   1. Load metrics for 1d/3d/7d windows from the metrics store
 *   2. Compute per-entity inputs across campaigns, ad-groups (top-N by spend),
 *      and keywords/targets (top-N by spend)
 *   3. Call evaluateEntity() for each
 *   4. Persist suggestions tagged with bucket/signals/confidence
 *   5. Record an optimization_runs audit row
 */
import { v4 as uuidv4 } from "uuid";
import { getAccount } from "@/lib/db/accounts";
import { getDb } from "@/lib/db";
import { listRules, createRule, createSuggestions } from "@/lib/db/rules-repo";
import {
  readCampaignMetrics, readCampaignMeta,
  readAdGroupMetrics,  readAdGroupMeta,
  readTargetingMetrics, readTargetingMeta,
} from "@/lib/db/metrics-store";
import {
  evaluateEntity, effectiveTarget,
  type OptimizerObjective, type OptimizerEntity, type WindowMetrics, type OptimizerSuggestion,
} from "./optimizer";
import { dateRangeFromPreset } from "@/lib/amazon-api/transform";
import { inferIntent, type Intent } from "@/lib/amazon-api/intent";
import { buildTargetResolver, type OptimizerProgram } from "@/lib/db/acos-targets-repo";

export interface OptimizerRunResult {
  accountId: string;
  objectiveId: string | null;
  entitiesScored: number;
  suggestionsCreated: number;
  byBucket: Record<string, number>;
  durationMs: number;
}

export interface OptimizerInput {
  accountId: string;
  objective: OptimizerObjective;
  topNAdGroups?: number;
  topNTargets?:  number;
}

const DEFAULT_TOP_AD_GROUPS = 50;
const DEFAULT_TOP_TARGETS   = 200;

export async function runOptimizerForAccount(input: OptimizerInput): Promise<OptimizerRunResult> {
  const t0 = Date.now();
  const acct = getAccount(input.accountId);
  if (!acct) throw new Error(`Account ${input.accountId} not found`);

  const topAg = input.topNAdGroups ?? DEFAULT_TOP_AD_GROUPS;
  const topTg = input.topNTargets  ?? DEFAULT_TOP_TARGETS;

  // ─── Date ranges for 1d / 3d / 7d ───────────────────────────────────────
  const r1 = dateRangeFromPreset("Yesterday");
  const r3 = relativeRange(3);
  const r7 = dateRangeFromPreset("Last 7D");

  // ACOS target matrix lookup (one read, in-memory resolver for all entities)
  const resolveTarget = buildTargetResolver(input.accountId);

  // ─── Campaign-level ─────────────────────────────────────────────────────
  const campMeta   = readCampaignMeta(input.accountId);
  const camp1 = aggCampaigns(readCampaignMetrics(input.accountId, r1.startDate, r1.endDate));
  const camp3 = aggCampaigns(readCampaignMetrics(input.accountId, r3.startDate, r3.endDate));
  const camp7 = aggCampaigns(readCampaignMetrics(input.accountId, r7.startDate, r7.endDate));

  // Account-wide CPC benchmark (used as a sanity check on individual entities)
  const acctAvgCpc = avgCpc(Array.from(camp7.values()));

  // Cache campaign-level (program, intent) once — ad groups + targets inherit
  // these via campaignId join so we don't have to re-classify every keyword.
  const campContext = new Map<string, { programKey: OptimizerProgram; intent: Intent; targetAcos: number | null }>();
  for (const m of campMeta) {
    const programKey: OptimizerProgram = m.program === "SB" && m.format === "VIDEO" ? "SB_VIDEO" : m.program;
    const intent = inferIntent(m.name);
    campContext.set(m.campaignId, {
      programKey, intent,
      targetAcos: resolveTarget(programKey, intent),
    });
  }

  const campaignEntities: OptimizerEntity[] = campMeta.map((m) => {
    const ctx = campContext.get(m.campaignId)!;
    return {
      id: m.campaignId,
      name: m.name ?? `Campaign ${m.campaignId}`,
      type: "CAMPAIGN",
      program: m.program,
      programKey: ctx.programKey,
      intent: ctx.intent,
      targetAcos: ctx.targetAcos ?? undefined,
      state: m.state ?? "ARCHIVED",
      currentValue: m.dailyBudget ?? 0,
      m1d: camp1.get(m.campaignId) ?? zeroWindow(),
      m3d: camp3.get(m.campaignId) ?? zeroWindow(),
      m7d: camp7.get(m.campaignId) ?? zeroWindow(),
      benchmark: { avgCpc: acctAvgCpc },
    };
  });

  // ─── Ad-group level (top by spend in 7d) ────────────────────────────────
  // SP doesn't expose an ad-group report — readAdGroupMetrics returns empty
  // for SP rows. We roll up targeting_metrics_daily by adGroupId for SP so
  // the engine actually sees the ad-group's metrics. Without this, every SP
  // ad group falls through to "below min spend" HOLD and the engine never
  // makes ad-group recommendations.
  const agMeta = readAdGroupMeta(input.accountId);
  const tgFor1 = readTargetingMetrics(input.accountId, r1.startDate, r1.endDate);
  const tgFor3 = readTargetingMetrics(input.accountId, r3.startDate, r3.endDate);
  const tgFor7 = readTargetingMetrics(input.accountId, r7.startDate, r7.endDate);
  const ag1 = aggAdGroupsWithSPFallback(readAdGroupMetrics(input.accountId, r1.startDate, r1.endDate), tgFor1);
  const ag3 = aggAdGroupsWithSPFallback(readAdGroupMetrics(input.accountId, r3.startDate, r3.endDate), tgFor3);
  const ag7 = aggAdGroupsWithSPFallback(readAdGroupMetrics(input.accountId, r7.startDate, r7.endDate), tgFor7);

  const sortedAgIds = [...ag7.entries()]
    .sort((a, b) => b[1].spend - a[1].spend)
    .slice(0, topAg)
    .map(([id]) => id);

  const agByIdMeta = new Map(agMeta.map((a) => [a.adGroupId, a]));
  const adGroupEntities: OptimizerEntity[] = sortedAgIds.map((id) => {
    const m = agByIdMeta.get(id);
    const ctx = m ? campContext.get(m.campaignId) : undefined;
    return {
      id,
      name: m?.name ?? `Ad Group ${id}`,
      type: "AD_GROUP",
      program: m?.program ?? "SP",
      programKey: ctx?.programKey,
      intent: ctx?.intent,
      targetAcos: ctx?.targetAcos ?? undefined,
      campaignId: m?.campaignId,
      state: m?.state ?? "ARCHIVED",
      currentValue: m?.defaultBid ?? 0,
      m1d: ag1.get(id) ?? zeroWindow(),
      m3d: ag3.get(id) ?? zeroWindow(),
      m7d: ag7.get(id) ?? zeroWindow(),
      benchmark: { avgCpc: acctAvgCpc },
    };
  });

  // ─── Target/keyword level (top by spend in 7d) ──────────────────────────
  const tgMeta = readTargetingMeta(input.accountId);
  const tg1 = aggTargets(tgFor1);
  const tg3 = aggTargets(tgFor3);
  const tg7 = aggTargets(tgFor7);

  const sortedTgIds = [...tg7.entries()]
    .sort((a, b) => b[1].spend - a[1].spend)
    .slice(0, topTg)
    .map(([id]) => id);

  const tgByIdMeta = new Map(tgMeta.map((t) => [t.targetId, t]));
  const targetEntities: OptimizerEntity[] = sortedTgIds.map((id) => {
    const m = tgByIdMeta.get(id);
    const ctx = m ? campContext.get(m.campaignId) : undefined;
    const type = m?.kind === "KEYWORD" ? "KEYWORD" : "PRODUCT_TARGET";
    return {
      id,
      name: m?.display ?? `id ${id}`,
      type,
      program: m?.program ?? "SP",
      programKey: ctx?.programKey,
      intent: ctx?.intent,
      targetAcos: ctx?.targetAcos ?? undefined,
      campaignId: m?.campaignId,
      adGroupId:  m?.adGroupId,
      state: m?.state ?? "ARCHIVED",
      currentValue: m?.bid ?? 0,
      m1d: tg1.get(id) ?? zeroWindow(),
      m3d: tg3.get(id) ?? zeroWindow(),
      m7d: tg7.get(id) ?? zeroWindow(),
      benchmark: { avgCpc: acctAvgCpc },
    };
  });

  // ─── Hierarchical cascade ───────────────────────────────────────────────
  // Pass 1: keywords / product targets — find PAUSE candidates first.
  // Pass 2: ad groups — re-evaluate with the bad children removed. If the
  //   projected ACOS now meets target, the ad-group action is downgraded to
  //   HOLD ("KW-pauses sufficient").
  // Pass 3: campaigns — same logic, removing both the KW pauses and the
  //   ad-group pauses we ended up keeping.
  const rule = ensureOptimizerRule();
  const evalMap = new Map<string, OptimizerSuggestion>();
  const byBucket: Record<string, number> = {};

  // Pass 1
  for (const e of targetEntities) {
    if (e.state !== "ENABLED" && e.state !== "PAUSED") continue;
    evalMap.set(e.id, evaluateEntity(e, input.objective));
  }

  const adGroupDeflation = new Map<string, Deflation>();
  const campaignDeflation = new Map<string, Deflation>();
  for (const e of targetEntities) {
    const ev = evalMap.get(e.id);
    if (!ev || ev.bucket !== "PAUSE") continue;
    const d = entityDeflation(e);
    if (e.adGroupId)  addDeflation(adGroupDeflation,  e.adGroupId,  d);
    if (e.campaignId) addDeflation(campaignDeflation, e.campaignId, d);
  }

  // Pass 2
  for (const e of adGroupEntities) {
    if (e.state !== "ENABLED" && e.state !== "PAUSED") continue;
    const raw = evaluateEntity(e, input.objective);
    const d = adGroupDeflation.get(e.id);
    const cascaded = cascadeIfHelps(e, raw, d, input.objective, "KW");
    evalMap.set(e.id, cascaded);
  }

  // Roll ad-group level PAUSE recommendations up into campaign deflation —
  // the campaign's projected ACOS should account for those too.
  for (const e of adGroupEntities) {
    const ev = evalMap.get(e.id);
    if (!ev || ev.bucket !== "PAUSE") continue;
    if (!e.campaignId) continue;
    const ownKwDef = adGroupDeflation.get(e.id);
    const remaining: Deflation = {
      spend:       Math.max(0, e.m7d.spend       - (ownKwDef?.spend       ?? 0)),
      sales:       Math.max(0, e.m7d.sales       - (ownKwDef?.sales       ?? 0)),
      orders:      Math.max(0, e.m7d.orders      - (ownKwDef?.orders      ?? 0)),
      clicks:      Math.max(0, e.m7d.clicks      - (ownKwDef?.clicks      ?? 0)),
      impressions: Math.max(0, e.m7d.impressions - (ownKwDef?.impressions ?? 0)),
      count: 1,
    };
    addDeflation(campaignDeflation, e.campaignId, remaining);
  }

  // Pass 3
  for (const e of campaignEntities) {
    if (e.state !== "ENABLED" && e.state !== "PAUSED") continue;
    const raw = evaluateEntity(e, input.objective);
    const d = campaignDeflation.get(e.id);
    const cascaded = cascadeIfHelps(e, raw, d, input.objective, "child");
    evalMap.set(e.id, cascaded);
  }

  // ─── Portfolio scale guardrail ─────────────────────────────────────────
  // Cap how much m7d.sales the engine is allowed to put at risk in a single
  // run. Worst-ACOS cuts go first; once we'd exceed the cap, remaining
  // cuts become HOLD with a "scale guardrail" reason.
  const allEntities = [...targetEntities, ...adGroupEntities, ...campaignEntities];
  applyScaleGuardrail(allEntities, evalMap, campaignEntities, input.objective);

  // Build inserts
  const inserts: Parameters<typeof createSuggestions>[0] = [];
  for (const e of allEntities) {
    const out = evalMap.get(e.id);
    if (!out || out.bucket === "HOLD") continue;
    byBucket[out.bucket] = (byBucket[out.bucket] ?? 0) + 1;
    inserts.push({
      ruleId:        rule.id,
      accountId:     input.accountId,
      targetType:    e.type,
      targetId:      e.id,
      targetName:    e.name,
      program:       e.program ?? null,
      actionType:    out.actionType,
      actionValue:   out.actionValue,
      currentValue:  e.currentValue,
      reason:        out.reason,
      expectedImpact: null,
      metricSnapshot: out.signals as unknown as Record<string, number>,
    });
  }

  const created = createSuggestions(inserts);

  // Stamp bucket / signals / confidence on the rows we just inserted.
  const stmt = getDb().prepare(`
    UPDATE suggestions SET bucket = ?, signals_json = ?, confidence = ?
    WHERE rule_id = ? AND account_id = ? AND target_id = ? AND status = 'PENDING'
      AND created_at >= datetime('now', '-60 seconds')
  `);
  for (const ins of inserts) {
    const out = evalMap.get(ins.targetId);
    if (!out) continue;
    stmt.run(out.bucket, JSON.stringify(out.signals), out.confidence, rule.id, input.accountId, ins.targetId);
  }

  // Audit log row
  getDb().prepare(`
    INSERT INTO optimization_runs (id, account_id, objective_id, window_label, entities_scored, suggestions_created)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), input.accountId, null, "1d/3d/7d", allEntities.length, created);

  return {
    accountId: input.accountId,
    objectiveId: null,
    entitiesScored: allEntities.length,
    suggestionsCreated: created,
    byBucket,
    durationMs: Date.now() - t0,
  };
}

// ─── Cascade helpers ────────────────────────────────────────────────────────

interface Deflation {
  spend: number; sales: number; orders: number; clicks: number; impressions: number;
  count: number;
}

function entityDeflation(e: OptimizerEntity): Deflation {
  return {
    spend: e.m7d.spend, sales: e.m7d.sales, orders: e.m7d.orders,
    clicks: e.m7d.clicks, impressions: e.m7d.impressions, count: 1,
  };
}

function addDeflation(map: Map<string, Deflation>, parentId: string, d: Deflation) {
  const cur = map.get(parentId);
  if (!cur) { map.set(parentId, { ...d }); return; }
  cur.spend += d.spend; cur.sales += d.sales; cur.orders += d.orders;
  cur.clicks += d.clicks; cur.impressions += d.impressions;
  cur.count += d.count;
}

/**
 * If the raw evaluation wants a SCALE_DOWN / BID_DOWN / PAUSE on this entity
 * but the projected metrics (with flagged children removed) would meet
 * target, downgrade to HOLD and explain the cascade. If they wouldn't meet
 * target, annotate the original reason so reviewers know surgical fixes
 * alone aren't enough.
 *
 * `childKind` is just a label for the reason string ("KW" or "child").
 */
function cascadeIfHelps(
  e: OptimizerEntity,
  raw: OptimizerSuggestion,
  d: Deflation | undefined,
  obj: OptimizerObjective,
  childKind: string,
): OptimizerSuggestion {
  if (!d || d.count === 0) return raw;

  const downgradable = raw.bucket === "SCALE_DOWN" || raw.bucket === "BID_DOWN" || raw.bucket === "PAUSE";
  if (!downgradable) return raw;

  const target = effectiveTarget(e, obj);
  const projSpend = Math.max(0, e.m7d.spend - d.spend);
  const projSales = Math.max(0, e.m7d.sales - d.sales);
  const projAcos  = projSales > 0 ? (projSpend / projSales) * 100 : null;

  // Slack: allow up to 10% above target before we still escalate.
  if (projAcos != null && projAcos <= target * 1.1) {
    return {
      ...raw,
      bucket: "HOLD",
      actionType: "ENABLE",
      actionValue: null,
      reason: `Pausing ${d.count} ${childKind}${d.count > 1 ? "s" : ""} projects ACOS ${projAcos.toFixed(1)}% ≤ target ${target.toFixed(1)}%. No ${e.type === "CAMPAIGN" ? "campaign" : "ad-group"}-level change needed.`,
      confidence: 0.7,
      signals: {
        ...raw.signals,
        cascadeChildrenPaused: d.count,
        cascadeProjectedAcos:  projAcos,
      } as unknown as OptimizerSuggestion["signals"],
    };
  }

  // Cascade can't save it — keep original action, prefix reason.
  const projStr = projAcos != null ? `${projAcos.toFixed(1)}%` : "still no sales";
  return {
    ...raw,
    reason: `Even after pausing ${d.count} ${childKind}${d.count > 1 ? "s" : ""}, projected ACOS ${projStr} > target ${target.toFixed(1)}%. ${raw.reason}`,
    signals: {
      ...raw.signals,
      cascadeChildrenPaused: d.count,
      cascadeProjectedAcos:  projAcos,
    } as unknown as OptimizerSuggestion["signals"],
  };
}

// Lazy global rule that owns all optimizer-generated suggestions.
let _optimizerRuleCache: { id: string } | null = null;
function ensureOptimizerRule() {
  if (_optimizerRuleCache) return _optimizerRuleCache;
  const existing = listRules({ accountId: undefined }).find((r) => r.name === RULE_NAME && r.accountId === null);
  if (existing) { _optimizerRuleCache = existing; return existing; }
  const fresh = createRule({
    name: RULE_NAME, accountId: null, objectiveId: null,
    appliesTo: "CAMPAIGN", programs: null,
    conditions: { op: "AND", clauses: [] },
    actions: [], mode: "SUGGEST", enabled: true,
  });
  _optimizerRuleCache = fresh;
  return fresh;
}
const RULE_NAME = "AI Optimizer";

// ─── Helpers ────────────────────────────────────────────────────────────────

function zeroWindow(): WindowMetrics {
  return { spend: 0, sales: 0, orders: 0, impressions: 0, clicks: 0, topOfSearchIS: null };
}

function aggCampaigns(rows: { campaignId: string; cost: number; sales: number; orders: number; clicks: number; impressions: number; topOfSearchIS?: number | null }[]): Map<string, WindowMetrics> {
  const out = new Map<string, WindowMetrics>();
  // Average impression share weighted by impressions
  const totalsForIS = new Map<string, { impr: number; weighted: number }>();
  for (const r of rows) {
    const cur = out.get(r.campaignId) ?? zeroWindow();
    cur.spend += r.cost; cur.sales += r.sales; cur.orders += r.orders;
    cur.clicks += r.clicks; cur.impressions += r.impressions;
    out.set(r.campaignId, cur);

    if (r.topOfSearchIS != null && r.impressions > 0) {
      const t = totalsForIS.get(r.campaignId) ?? { impr: 0, weighted: 0 };
      t.weighted += r.topOfSearchIS * r.impressions;
      t.impr += r.impressions;
      totalsForIS.set(r.campaignId, t);
    }
  }
  for (const [id, t] of totalsForIS) {
    const cur = out.get(id);
    if (cur && t.impr > 0) cur.topOfSearchIS = t.weighted / t.impr;
  }
  return out;
}

/**
 * Aggregate ad-group rows + roll up SP targeting rows into ad-group buckets
 * for any ad-group that has no direct row (Amazon doesn't expose an SP
 * ad-group report — same workaround hierarchy-service uses).
 */
function aggAdGroupsWithSPFallback(
  agRows: { adGroupId: string; program: string; cost: number; sales: number; orders: number; clicks: number; impressions: number }[],
  tgRows: { adGroupId: string; program: string; cost: number; sales: number; orders: number; clicks: number; impressions: number }[],
): Map<string, WindowMetrics> {
  const out = new Map<string, WindowMetrics>();
  const hasDirect = new Set<string>();
  for (const r of agRows) {
    hasDirect.add(r.adGroupId);
    const cur = out.get(r.adGroupId) ?? zeroWindow();
    cur.spend += r.cost; cur.sales += r.sales; cur.orders += r.orders;
    cur.clicks += r.clicks; cur.impressions += r.impressions;
    out.set(r.adGroupId, cur);
  }
  for (const r of tgRows) {
    if (r.program !== "SP") continue;
    if (hasDirect.has(r.adGroupId)) continue;
    const cur = out.get(r.adGroupId) ?? zeroWindow();
    cur.spend += r.cost; cur.sales += r.sales; cur.orders += r.orders;
    cur.clicks += r.clicks; cur.impressions += r.impressions;
    out.set(r.adGroupId, cur);
  }
  return out;
}

function aggTargets(rows: { targetId: string; cost: number; sales: number; orders: number; clicks: number; impressions: number }[]): Map<string, WindowMetrics> {
  const out = new Map<string, WindowMetrics>();
  for (const r of rows) {
    const cur = out.get(r.targetId) ?? zeroWindow();
    cur.spend += r.cost; cur.sales += r.sales; cur.orders += r.orders;
    cur.clicks += r.clicks; cur.impressions += r.impressions;
    out.set(r.targetId, cur);
  }
  return out;
}

function avgCpc(rows: WindowMetrics[]): number {
  const totalSpend  = rows.reduce((s, r) => s + r.spend, 0);
  const totalClicks = rows.reduce((s, r) => s + r.clicks, 0);
  return totalClicks > 0 ? totalSpend / totalClicks : 0;
}

function relativeRange(days: number) {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const end = new Date();
  const start = new Date(); start.setDate(end.getDate() - days);
  return { startDate: fmt(start), endDate: fmt(end) };
}

// ─── Portfolio scale guardrail ──────────────────────────────────────────────

/**
 * Walks every PAUSE / SCALE_DOWN / BID_DOWN suggestion in order of worst
 * ACOS first. As long as the cumulative m7d.sales of accepted cuts stays
 * under the cap, suggestions pass through unchanged; once we'd exceed the
 * cap, remaining cuts get demoted to HOLD and annotated with a "scale
 * guardrail" reason.
 *
 * Mutates `evalMap` in place.
 */
function applyScaleGuardrail(
  allEntities: OptimizerEntity[],
  evalMap: Map<string, OptimizerSuggestion>,
  campaignEntities: OptimizerEntity[],
  obj: OptimizerObjective,
): void {
  const cap = obj.maxPortfolioSalesLossPct;
  if (!Number.isFinite(cap) || cap <= 0 || cap >= 100) return;

  // Use campaign-level totals as the portfolio denominator; KW/AG sales are
  // a subset of campaign sales, so summing campaigns avoids double-counting.
  const portfolioSales = campaignEntities.reduce((s, e) => s + (e.m7d.sales || 0), 0);
  if (portfolioSales <= 0) return;
  const salesBudget = portfolioSales * (cap / 100);

  interface Candidate {
    id: string; entity: OptimizerEntity; eval: OptimizerSuggestion;
    salesAtRisk: number; acos7d: number;
  }
  const entityById = new Map(allEntities.map((e) => [e.id, e]));
  const candidates: Candidate[] = [];

  for (const [id, ev] of evalMap) {
    if (ev.bucket !== "PAUSE" && ev.bucket !== "SCALE_DOWN" && ev.bucket !== "BID_DOWN") continue;
    const entity = entityById.get(id);
    if (!entity) continue;

    let sar: number;
    if (ev.bucket === "PAUSE") {
      sar = entity.m7d.sales;
    } else {
      // Bid/budget cut → sales loss approximately proportional to the cut.
      const cutFrac = (entity.currentValue > 0 && ev.actionValue != null)
        ? Math.max(0, (entity.currentValue - ev.actionValue) / entity.currentValue)
        : 0;
      sar = entity.m7d.sales * cutFrac;
    }
    const acos = ev.signals.acos7d ?? Number.POSITIVE_INFINITY;
    candidates.push({ id, entity, eval: ev, salesAtRisk: sar, acos7d: acos });
  }

  // Worst ACOS first — those cuts have the strongest case for being kept.
  candidates.sort((a, b) => b.acos7d - a.acos7d);

  let cumLoss = 0;
  for (const c of candidates) {
    if (c.salesAtRisk <= 0) continue;            // free cut, pass
    if (cumLoss + c.salesAtRisk <= salesBudget) {
      cumLoss += c.salesAtRisk;
      continue;
    }
    // Doesn't fit — demote.
    evalMap.set(c.id, {
      ...c.eval,
      bucket: "HOLD",
      actionType: "ENABLE",
      actionValue: null,
      reason: `Scale guardrail: portfolio sales-at-risk budget (${salesBudget.toFixed(0)}) reached after worse-ACOS cuts. Holding this ${c.entity.type === "CAMPAIGN" ? "campaign" : c.entity.type === "AD_GROUP" ? "ad group" : "target"} so total sales aren't impacted. Original call: ${c.eval.reason}`,
      confidence: 0.5,
      signals: {
        ...c.eval.signals,
        guardrailHeld: true,
        guardrailSalesAtRisk: c.salesAtRisk,
      } as unknown as OptimizerSuggestion["signals"],
    });
  }
}

