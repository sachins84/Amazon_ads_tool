/**
 * Incremental refresh: pulls trailing N days from Amazon, upserts into the
 * metrics store. Used by the daily 8 AM cron + the dashboard refresh button.
 *
 * Default window: 14 days. That covers Amazon's attribution backfill — older
 * data won't change, so we never re-pull it.
 */
import { getAccount } from "@/lib/db/accounts";
import {
  upsertCampaignMetrics, upsertAdGroupMetrics,
  upsertCampaignMeta,    upsertAdGroupMeta,
  setRefreshState,
  type CampaignDailyRow, type AdGroupDailyRow,
  type CampaignMetaRow,  type AdGroupMetaRow,
} from "@/lib/db/metrics-store";
import { listAllCampaigns }      from "./campaigns";
import { listAllAdGroups }       from "./adgroups";
import {
  fetchAllProgramReports, fetchAllAdGroupReports,
  type Program,
} from "./reports";

export interface RefreshResult {
  accountId: string;
  brandName: string;
  windowStart: string;
  windowEnd:   string;
  campaignRowsUpserted: number;
  adGroupRowsUpserted:  number;
  campaignMetaUpserted: number;
  adGroupMetaUpserted:  number;
  durationMs: number;
  errors: { program: Program; error: string; phase: "campaigns" | "adgroups" | "list_campaigns" | "list_adgroups" }[];
}

export async function refreshAccountRecent(accountId: string, days = 14): Promise<RefreshResult> {
  const acct = getAccount(accountId);
  if (!acct) throw new Error(`Account ${accountId} not found`);

  const start = Date.now();
  const windowEnd = todayUTC();
  const windowStart = daysAgoUTC(days);
  const errors: RefreshResult["errors"] = [];

  // ─── 1. Fetch all 4 things in parallel ─────────────────────────────────
  const [campaignsResult, adGroupsResult, campaignReports, adGroupReports] = await Promise.all([
    listAllCampaigns(acct.adsProfileId, accountId).catch((e) => {
      errors.push({ program: "SP", error: String(e), phase: "list_campaigns" });
      return { campaigns: [], errors: [] };
    }),
    listAllAdGroups(acct.adsProfileId, undefined, accountId).catch((e) => {
      errors.push({ program: "SP", error: String(e), phase: "list_adgroups" });
      return { adGroups: [], errors: [] };
    }),
    fetchAllProgramReports(acct.adsProfileId, windowStart, windowEnd, accountId).catch((e) => {
      errors.push({ program: "SP", error: String(e), phase: "campaigns" });
      return { rows: [], errors: [] };
    }),
    fetchAllAdGroupReports(acct.adsProfileId, windowStart, windowEnd, accountId).catch((e) => {
      errors.push({ program: "SP", error: String(e), phase: "adgroups" });
      return { rows: [], errors: [] };
    }),
  ]);

  for (const e of campaignsResult.errors) errors.push({ program: e.program, error: e.error, phase: "list_campaigns" });
  for (const e of adGroupsResult.errors)  errors.push({ program: e.program, error: e.error, phase: "list_adgroups" });
  for (const e of campaignReports.errors) errors.push({ program: e.program, error: e.error, phase: "campaigns" });
  for (const e of adGroupReports.errors)  errors.push({ program: e.program, error: e.error, phase: "adgroups" });

  // ─── 2. Upsert metadata + daily metrics ────────────────────────────────
  const campaignMeta: CampaignMetaRow[] = campaignsResult.campaigns.map((c) => ({
    accountId, campaignId: c.campaignId, program: c.program,
    name: c.name, state: c.state,
    dailyBudget: c.dailyBudget,
    portfolioId: c.portfolioId ?? null,
    targetingType: c.targetingType ?? null,
    brandEntityId: c.brandEntityId ?? null,
  }));

  const campaignDaily: CampaignDailyRow[] = campaignReports.rows
    .filter((r) => r.date)
    .map((r) => ({
      accountId, campaignId: r.campaignId, date: r.date, program: r.program,
      impressions: r.impressions, clicks: r.clicks, cost: r.cost, orders: r.orders, sales: r.sales,
    }));

  const adGroupMeta: AdGroupMetaRow[] = adGroupsResult.adGroups.map((ag) => ({
    accountId, adGroupId: ag.adGroupId, campaignId: ag.campaignId, program: ag.program,
    name: ag.name, state: ag.state, defaultBid: ag.defaultBid,
  }));

  const adGroupDaily: AdGroupDailyRow[] = adGroupReports.rows
    .filter((r) => r.date && r.adGroupId)
    .map((r) => ({
      accountId, campaignId: r.campaignId, adGroupId: r.adGroupId, adGroupName: r.adGroupName,
      date: r.date, program: r.program,
      impressions: r.impressions, clicks: r.clicks, cost: r.cost, orders: r.orders, sales: r.sales,
    }));

  const campaignMetaUpserted = upsertCampaignMeta(campaignMeta);
  const campaignRowsUpserted = upsertCampaignMetrics(campaignDaily);
  const adGroupMetaUpserted  = upsertAdGroupMeta(adGroupMeta);
  const adGroupRowsUpserted  = upsertAdGroupMetrics(adGroupDaily);

  const durationMs = Date.now() - start;
  const lastRefreshAt = new Date().toISOString();

  setRefreshState({
    accountId, level: "campaigns",
    lastRefreshAt, windowStart, windowEnd,
    rowsUpserted: campaignRowsUpserted,
    durationMs,
    error: errors.filter((e) => e.phase === "campaigns" || e.phase === "list_campaigns").map((e) => `${e.program}/${e.phase}: ${e.error.slice(0, 80)}`).join("; ") || null,
  });
  setRefreshState({
    accountId, level: "adgroups",
    lastRefreshAt, windowStart, windowEnd,
    rowsUpserted: adGroupRowsUpserted,
    durationMs,
    error: errors.filter((e) => e.phase === "adgroups" || e.phase === "list_adgroups").map((e) => `${e.program}/${e.phase}: ${e.error.slice(0, 80)}`).join("; ") || null,
  });

  return {
    accountId,
    brandName: acct.name,
    windowStart, windowEnd,
    campaignRowsUpserted,
    adGroupRowsUpserted,
    campaignMetaUpserted,
    adGroupMetaUpserted,
    durationMs,
    errors,
  };
}

// ─── Date helpers (UTC, YYYY-MM-DD) ─────────────────────────────────────────

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoUTC(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
