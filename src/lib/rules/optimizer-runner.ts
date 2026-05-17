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
  evaluateEntity, type OptimizerObjective, type OptimizerEntity, type WindowMetrics,
} from "./optimizer";
import { dateRangeFromPreset } from "@/lib/amazon-api/transform";

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

  // ─── Campaign-level ─────────────────────────────────────────────────────
  const campMeta   = readCampaignMeta(input.accountId);
  const camp1 = aggCampaigns(readCampaignMetrics(input.accountId, r1.startDate, r1.endDate));
  const camp3 = aggCampaigns(readCampaignMetrics(input.accountId, r3.startDate, r3.endDate));
  const camp7 = aggCampaigns(readCampaignMetrics(input.accountId, r7.startDate, r7.endDate));

  // Account-wide CPC benchmark (used as a sanity check on individual entities)
  const acctAvgCpc = avgCpc(Array.from(camp7.values()));

  const campaignEntities: OptimizerEntity[] = campMeta.map((m) => ({
    id: m.campaignId,
    name: m.name ?? `Campaign ${m.campaignId}`,
    type: "CAMPAIGN",
    program: m.program,
    state: m.state ?? "ARCHIVED",
    currentValue: m.dailyBudget ?? 0,
    m1d: camp1.get(m.campaignId) ?? zeroWindow(),
    m3d: camp3.get(m.campaignId) ?? zeroWindow(),
    m7d: camp7.get(m.campaignId) ?? zeroWindow(),
    benchmark: { avgCpc: acctAvgCpc },
  }));

  // ─── Ad-group level (top by spend in 7d) ────────────────────────────────
  const agMeta = readAdGroupMeta(input.accountId);
  const ag1 = aggAdGroups(readAdGroupMetrics(input.accountId, r1.startDate, r1.endDate));
  const ag3 = aggAdGroups(readAdGroupMetrics(input.accountId, r3.startDate, r3.endDate));
  const ag7 = aggAdGroups(readAdGroupMetrics(input.accountId, r7.startDate, r7.endDate));

  const sortedAgIds = [...ag7.entries()]
    .sort((a, b) => b[1].spend - a[1].spend)
    .slice(0, topAg)
    .map(([id]) => id);

  const agByIdMeta = new Map(agMeta.map((a) => [a.adGroupId, a]));
  const adGroupEntities: OptimizerEntity[] = sortedAgIds.map((id) => {
    const m = agByIdMeta.get(id);
    return {
      id,
      name: m?.name ?? `Ad Group ${id}`,
      type: "AD_GROUP",
      program: m?.program ?? "SP",
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
  const tg1 = aggTargets(readTargetingMetrics(input.accountId, r1.startDate, r1.endDate));
  const tg3 = aggTargets(readTargetingMetrics(input.accountId, r3.startDate, r3.endDate));
  const tg7 = aggTargets(readTargetingMetrics(input.accountId, r7.startDate, r7.endDate));

  const sortedTgIds = [...tg7.entries()]
    .sort((a, b) => b[1].spend - a[1].spend)
    .slice(0, topTg)
    .map(([id]) => id);

  const tgByIdMeta = new Map(tgMeta.map((t) => [t.targetId, t]));
  const targetEntities: OptimizerEntity[] = sortedTgIds.map((id) => {
    const m = tgByIdMeta.get(id);
    const type = m?.kind === "KEYWORD" ? "KEYWORD" : "PRODUCT_TARGET";
    return {
      id,
      name: m?.display ?? `id ${id}`,
      type,
      program: m?.program ?? "SP",
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

  // ─── Run the engine ─────────────────────────────────────────────────────
  const rule = ensureOptimizerRule();
  const allEntities = [...campaignEntities, ...adGroupEntities, ...targetEntities];

  const inserts: Parameters<typeof createSuggestions>[0] = [];
  const byBucket: Record<string, number> = {};

  for (const e of allEntities) {
    if (e.state !== "ENABLED" && e.state !== "PAUSED") continue;
    const out = evaluateEntity(e, input.objective);
    if (out.bucket === "HOLD") continue;
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

  // Stamp the bucket / signals / confidence on the rows we just inserted.
  // Suggestions table fields added in the schema migration.
  const stmt = getDb().prepare(`
    UPDATE suggestions SET bucket = ?, signals_json = ?, confidence = ?
    WHERE rule_id = ? AND account_id = ? AND target_id = ? AND status = 'PENDING'
      AND created_at >= datetime('now', '-30 seconds')
  `);
  for (let i = 0; i < inserts.length; i++) {
    const e = allEntities.find((x) => x.id === inserts[i].targetId);
    if (!e) continue;
    const sig = inserts[i].metricSnapshot as unknown as Record<string, unknown>;
    stmt.run(
      (sig?.bucket as string) ?? bucketByActionType(inserts[i].actionType, sig),
      JSON.stringify(sig),
      (sig?.confidence as number | undefined) ?? null,
      rule.id, input.accountId, inserts[i].targetId,
    );
  }

  // Audit log row
  getDb().prepare(`
    INSERT INTO optimization_runs (id, account_id, objective_id, window_label, entities_scored, suggestions_created)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), input.accountId, null, "1d/3d/7d", allEntities.length, created);

  // Cleaner: replace the bulk update with one that uses cached bucket values.
  // (The query above relied on bucket sitting in metricSnapshot — fix below.)
  syncOptimizerFields(rule.id, input.accountId, inserts, allEntities, input.objective);

  return {
    accountId: input.accountId,
    objectiveId: null,
    entitiesScored: allEntities.length,
    suggestionsCreated: created,
    byBucket,
    durationMs: Date.now() - t0,
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

function aggAdGroups(rows: { adGroupId: string; cost: number; sales: number; orders: number; clicks: number; impressions: number }[]): Map<string, WindowMetrics> {
  const out = new Map<string, WindowMetrics>();
  for (const r of rows) {
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

// Sync the new optimizer columns onto just-inserted suggestion rows.
function syncOptimizerFields(
  ruleId: string,
  accountId: string,
  inserts: Array<{ targetId: string; actionType: string; metricSnapshot: unknown }>,
  entities: OptimizerEntity[],
  obj: OptimizerObjective,
) {
  const stmt = getDb().prepare(`
    UPDATE suggestions
    SET bucket = ?, signals_json = ?, confidence = ?
    WHERE rule_id = ? AND account_id = ? AND target_id = ? AND status = 'PENDING'
      AND created_at >= datetime('now', '-60 seconds')
  `);
  for (const ins of inserts) {
    const e = entities.find((x) => x.id === ins.targetId);
    if (!e) continue;
    const out = evaluateEntity(e, obj);  // recompute to grab bucket + confidence cleanly
    stmt.run(out.bucket, JSON.stringify(out.signals), out.confidence, ruleId, accountId, ins.targetId);
  }
}

function bucketByActionType(actionType: string, _sig: unknown): string {
  // Fallback bucket inference if we somehow miss the engine's call.
  if (actionType === "PAUSE") return "PAUSE";
  if (actionType === "SET_BID") return "BID_DOWN";
  if (actionType === "SET_BUDGET") return "SCALE_DOWN";
  return "HOLD";
}
