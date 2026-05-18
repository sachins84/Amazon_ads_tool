/**
 * Run rules for an account.
 * Pulls the relevant dataset (campaigns / ad groups / keywords + targets)
 * via the existing overview-service / hierarchy-service, evaluates each
 * matching rule, and writes resulting suggestions to the DB.
 *
 * Note: keyword/target evaluation is currently scoped to an ad group at a
 * time. To run rules over an entire account's keywords we'd need a flat
 * targeting fetch — that's a future enhancement.
 */
import { listRules, createSuggestions, recordSuggestionRun, updateRule } from "@/lib/db/rules-repo";
import { getOverviewForAccount } from "@/lib/amazon-api/overview-service";
import { getAdGroupsForCampaign } from "@/lib/amazon-api/hierarchy-service";
import { readTargetingMetrics, readTargetingMeta } from "@/lib/db/metrics-store";
import { dateRangeFromPreset } from "@/lib/amazon-api/transform";
import { evaluateRule } from "./engine";
import type { Rule, MetricRow, Program } from "./types";

const TOP_TARGETS_FOR_RULES = 500;

export interface RunResult {
  accountId: string;
  dateRange: string;
  rulesEvaluated: number;
  suggestionsCreated: number;
  byRule: { ruleId: string; ruleName: string; created: number; error?: string }[];
}

interface WindowDataset {
  campaignRows: MetricRow[];
  adGroupRows:  MetricRow[];
  keywordRows:  MetricRow[];
  patRows:      MetricRow[];
}

export async function runRulesForAccount(
  accountId: string,
  datePreset: string,
): Promise<RunResult> {
  const allRules = listRules({ accountId, enabledOnly: true });
  if (allRules.length === 0) {
    return { accountId, dateRange: datePreset, rulesEvaluated: 0, suggestionsCreated: 0, byRule: [] };
  }

  // Each rule carries its own analytical window. Group by window so we
  // only fetch each unique dataset once even if many rules share it.
  const ruleWindows = new Map<string, Set<"CAMPAIGN" | "AD_GROUP" | "KEYWORD" | "PRODUCT_TARGET">>();
  for (const r of allRules) {
    const w = r.window || datePreset;
    if (!ruleWindows.has(w)) ruleWindows.set(w, new Set());
    ruleWindows.get(w)!.add(r.appliesTo);
  }

  const datasetsByWindow = new Map<string, WindowDataset>();
  for (const [window, needs] of ruleWindows) {
    datasetsByWindow.set(window, await loadDatasetForWindow(accountId, window, needs));
  }

  const byRule: RunResult["byRule"] = [];
  let totalCreated = 0;

  for (const rule of allRules) {
    try {
      const ds = datasetsByWindow.get(rule.window || datePreset)!;
      const dataset = pickDataset(rule, ds);
      const evaluated = evaluateRule(rule, dataset);

      const toInsert = evaluated.map((e) => ({
        ruleId: e.ruleId,
        accountId,
        targetType: e.targetType,
        targetId: e.targetId,
        targetName: e.targetName,
        program: e.program,
        actionType: e.actionType,
        actionValue: e.actionValue,
        currentValue: e.currentValue,
        reason: e.reason,
        expectedImpact: e.expectedImpact,
        metricSnapshot: e.metricSnapshot,
      }));

      const created = createSuggestions(toInsert);
      totalCreated += created;
      byRule.push({ ruleId: rule.id, ruleName: rule.name, created });
      recordSuggestionRun({ ruleId: rule.id, accountId, suggestionsCreated: created });
      updateRule(rule.id, { lastRunAt: new Date().toISOString() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      byRule.push({ ruleId: rule.id, ruleName: rule.name, created: 0, error: msg });
      recordSuggestionRun({ ruleId: rule.id, accountId, suggestionsCreated: 0, error: msg });
    }
  }

  return { accountId, dateRange: datePreset, rulesEvaluated: allRules.length, suggestionsCreated: totalCreated, byRule };
}

function pickDataset(
  rule: Rule,
  rows: { campaignRows: MetricRow[]; adGroupRows: MetricRow[]; keywordRows: MetricRow[]; patRows: MetricRow[] },
): MetricRow[] {
  if (rule.appliesTo === "CAMPAIGN")       return rows.campaignRows;
  if (rule.appliesTo === "AD_GROUP")       return rows.adGroupRows;
  if (rule.appliesTo === "KEYWORD")        return rows.keywordRows;
  if (rule.appliesTo === "PRODUCT_TARGET") return rows.patRows;
  return [];
}

/**
 * Build the four flat MetricRow tables for a given window. Called once per
 * unique window across the rules set; campaigns + ad-groups come from the
 * overview/hierarchy services (already window-aware), keywords + product
 * targets aggregate the metrics store directly.
 */
async function loadDatasetForWindow(
  accountId: string,
  window: string,
  needs: Set<"CAMPAIGN" | "AD_GROUP" | "KEYWORD" | "PRODUCT_TARGET">,
): Promise<WindowDataset> {
  const needCampaigns = needs.has("CAMPAIGN");
  const needAdGroups  = needs.has("AD_GROUP");
  const needKeywords  = needs.has("KEYWORD");
  const needPATs      = needs.has("PRODUCT_TARGET");

  const overview = (needCampaigns || needAdGroups)
    ? await getOverviewForAccount(accountId, window)
    : null;

  const campaignRows: MetricRow[] = (overview?.campaigns ?? []).map((c) => ({
    id: c.id, name: c.name, program: c.type as Program,
    campaignId: c.id, adGroupId: null,
    currentValue: c.budget,
    spend: c.spend, sales: c.sales, orders: c.orders,
    impressions: c.impressions, clicks: c.clicks,
    ctr: c.ctr, cpc: c.cpc, cvr: c.cvr, acos: c.acos, roas: c.roas,
  }));

  let adGroupRows: MetricRow[] = [];
  if (needAdGroups && overview) {
    const TOP = 20;
    const topCampaignIds = [...overview.campaigns]
      .sort((a, b) => b.spend - a.spend)
      .slice(0, TOP)
      .map((c) => c.id);
    const results = await Promise.allSettled(
      topCampaignIds.map((cid) => getAdGroupsForCampaign(accountId, cid, window)),
    );
    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      for (const ag of r.value.adGroups) {
        adGroupRows.push({
          id: ag.id, name: ag.name, program: ag.type as Program,
          campaignId: ag.campaignId, adGroupId: ag.id,
          currentValue: ag.defaultBid,
          spend: ag.spend, sales: ag.sales, orders: ag.orders,
          impressions: ag.impressions, clicks: ag.clicks,
          ctr: ag.ctr, cpc: ag.cpc, cvr: ag.cvr, acos: ag.acos, roas: ag.roas,
        });
      }
    }
  }

  const keywordRows: MetricRow[] = [];
  const patRows:     MetricRow[] = [];
  if (needKeywords || needPATs) {
    const range = dateRangeFromPreset(window);
    const meta = readTargetingMeta(accountId);
    const metaById = new Map(meta.map((m) => [m.targetId, m]));
    const daily = readTargetingMetrics(accountId, range.startDate, range.endDate);

    const agg = new Map<string, { cost: number; sales: number; orders: number; clicks: number; impressions: number }>();
    for (const r of daily) {
      const cur = agg.get(r.targetId) ?? { cost: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 };
      cur.cost += r.cost; cur.sales += r.sales; cur.orders += r.orders;
      cur.clicks += r.clicks; cur.impressions += r.impressions;
      agg.set(r.targetId, cur);
    }
    const ranked = [...agg.entries()]
      .sort((a, b) => b[1].cost - a[1].cost)
      .slice(0, TOP_TARGETS_FOR_RULES);

    for (const [id, m] of ranked) {
      const md = metaById.get(id);
      if (!md) continue;
      const ctr = m.impressions > 0 ? (m.clicks / m.impressions) * 100 : 0;
      const cpc = m.clicks > 0 ? m.cost / m.clicks : 0;
      const cvr = m.clicks > 0 ? (m.orders / m.clicks) * 100 : 0;
      const acos = m.sales > 0 ? (m.cost / m.sales) * 100 : 0;
      const roas = m.cost > 0 ? m.sales / m.cost : 0;
      const row: MetricRow = {
        id, name: md.display ?? `id ${id}`, program: md.program as Program,
        campaignId: md.campaignId, adGroupId: md.adGroupId,
        currentValue: md.bid ?? 0,
        spend: m.cost, sales: m.sales, orders: m.orders,
        impressions: m.impressions, clicks: m.clicks,
        ctr, cpc, cvr, acos, roas,
      };
      if (md.kind === "KEYWORD") keywordRows.push(row);
      else                       patRows.push(row);
    }
  }

  return { campaignRows, adGroupRows, keywordRows, patRows };
}
