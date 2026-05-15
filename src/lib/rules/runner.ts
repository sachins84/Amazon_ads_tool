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
import { evaluateRule } from "./engine";
import type { Rule, MetricRow, Program } from "./types";

export interface RunResult {
  accountId: string;
  dateRange: string;
  rulesEvaluated: number;
  suggestionsCreated: number;
  byRule: { ruleId: string; ruleName: string; created: number; error?: string }[];
}

export async function runRulesForAccount(
  accountId: string,
  datePreset: string,
): Promise<RunResult> {
  const allRules = listRules({ accountId, enabledOnly: true });
  if (allRules.length === 0) {
    return { accountId, dateRange: datePreset, rulesEvaluated: 0, suggestionsCreated: 0, byRule: [] };
  }

  // We only fetch what's actually needed. Group rules by appliesTo.
  const needCampaigns = allRules.some((r) => r.appliesTo === "CAMPAIGN");
  const needAdGroups  = allRules.some((r) => r.appliesTo === "AD_GROUP");
  // KEYWORD / PRODUCT_TARGET are scoped per-ad-group → too heavy to do without a
  // user-chosen scope. Suggestion run for those targets must specify a campaign
  // (skipped from the auto-run for now).

  const overview = (needCampaigns || needAdGroups)
    ? await getOverviewForAccount(accountId, datePreset)
    : null;

  // Map campaign-level rows.
  const campaignRows: MetricRow[] = (overview?.campaigns ?? []).map((c) => ({
    id: c.id, name: c.name, program: c.type as Program,
    campaignId: c.id, adGroupId: null,
    currentValue: c.budget,
    spend: c.spend, sales: c.sales, orders: c.orders,
    impressions: c.impressions, clicks: c.clicks,
    ctr: c.ctr, cpc: c.cpc, cvr: c.cvr, acos: c.acos, roas: c.roas,
  }));

  // Map ad-group level by fanning the campaigns we have. Could be heavy; cap to
  // the top-spending campaigns to keep first-run fast.
  let adGroupRows: MetricRow[] = [];
  if (needAdGroups && overview) {
    const TOP = 20;
    const topCampaignIds = [...overview.campaigns]
      .sort((a, b) => b.spend - a.spend)
      .slice(0, TOP)
      .map((c) => c.id);
    const results = await Promise.allSettled(
      topCampaignIds.map((cid) => getAdGroupsForCampaign(accountId, cid, datePreset)),
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

  const byRule: RunResult["byRule"] = [];
  let totalCreated = 0;

  for (const rule of allRules) {
    try {
      const dataset = pickDataset(rule, { campaignRows, adGroupRows });
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
  rows: { campaignRows: MetricRow[]; adGroupRows: MetricRow[] },
): MetricRow[] {
  if (rule.appliesTo === "CAMPAIGN")  return rows.campaignRows;
  if (rule.appliesTo === "AD_GROUP")  return rows.adGroupRows;
  // KEYWORD / PRODUCT_TARGET not in account-wide auto-run yet.
  return [];
}
