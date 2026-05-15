/**
 * Hierarchy drill-down services: ad groups for a campaign, targets for an ad group.
 * Both read from the SQLite metrics store (populated by the daily refresh).
 */
import type { Program } from "./reports";
import { dateRangeFromPreset } from "./transform";
import { getAccount } from "@/lib/db/accounts";
import {
  readAdGroupMetrics, readAdGroupMeta,
  readTargetingMetrics, readTargetingMeta,
  getRefreshState,
} from "@/lib/db/metrics-store";

export interface AdGroupRow {
  id: string;
  name: string;
  type: Program;
  status: "ENABLED" | "PAUSED" | "ARCHIVED";
  defaultBid: number;
  campaignId: string;
  spend: number;
  sales: number;
  orders: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cvr: number;
  acos: number;
  roas: number;
}

export interface AdGroupOverview {
  brandName: string | null;
  marketplace: string;
  currency: string;
  campaignId: string;
  dateRange: { startDate: string; endDate: string };
  adGroups: AdGroupRow[];
  dailySeries: { date: string; spend: number; sales: number; orders: number; clicks: number; impressions: number }[];
  totals: { spend: number; sales: number; orders: number; clicks: number; impressions: number; acos: number; roas: number };
  errors: {
    adGroups: { program: Program; error: string }[];
    reports:  { program: Program; error: string }[];
  };
  freshness: {
    lastRefreshAt: string | null;
    error:         string | null;
    stale:         boolean;
  };
}

export async function getAdGroupsForCampaign(
  accountId: string,
  campaignId: string,
  datePreset: string,
): Promise<AdGroupOverview> {
  const acct = getAccount(accountId);
  if (!acct) throw new Error(`Account ${accountId} not found`);

  const marketplace = acct.adsMarketplace;
  const brandName   = acct.name;
  const currency    = acct.adsMarketplace === "IN" ? "INR" : "USD";

  const { startDate, endDate } = dateRangeFromPreset(datePreset);

  // Read from store
  const dailyRows = readAdGroupMetrics(accountId, startDate, endDate, campaignId);
  const meta      = readAdGroupMeta(accountId, campaignId);
  const refreshState = getRefreshState(accountId, "adgroups");

  const byAg = new Map<string, { program: Program; impressions: number; clicks: number; cost: number; orders: number; sales: number }>();
  const byDate = new Map<string, { spend: number; sales: number; orders: number; clicks: number; impressions: number }>();

  for (const r of dailyRows) {
    const agg = byAg.get(r.adGroupId) ?? { program: r.program, impressions: 0, clicks: 0, cost: 0, orders: 0, sales: 0 };
    agg.impressions += r.impressions; agg.clicks += r.clicks; agg.cost += r.cost; agg.orders += r.orders; agg.sales += r.sales;
    byAg.set(r.adGroupId, agg);

    const d = byDate.get(r.date) ?? { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 };
    d.spend += r.cost; d.sales += r.sales; d.orders += r.orders; d.clicks += r.clicks; d.impressions += r.impressions;
    byDate.set(r.date, d);
  }

  const rows: AdGroupRow[] = meta.map((ag) => {
    const m = byAg.get(ag.adGroupId);
    const spend = m?.cost ?? 0;
    const sales = m?.sales ?? 0;
    const clicks = m?.clicks ?? 0;
    const impr   = m?.impressions ?? 0;
    const orders = m?.orders ?? 0;
    return {
      id: ag.adGroupId, name: ag.name ?? `Ad Group ${ag.adGroupId}`, type: ag.program, status: ag.state ?? "ARCHIVED",
      defaultBid: ag.defaultBid ?? 0, campaignId: ag.campaignId,
      spend: round2(spend), sales: round2(sales), orders,
      impressions: impr, clicks,
      ctr: pct(clicks, impr), cpc: div(spend, clicks),
      cvr: pct(orders, clicks), acos: pct(spend, sales, 1),
      roas: div(sales, spend),
    };
  });

  // Pick up any daily rows whose ad-group meta is missing.
  const seen = new Set(rows.map((r) => r.id));
  for (const [adGroupId, m] of byAg) {
    if (seen.has(adGroupId)) continue;
    rows.push({
      id: adGroupId, name: `Ad Group ${adGroupId}`, type: m.program,
      status: "ARCHIVED", defaultBid: 0, campaignId,
      spend: round2(m.cost), sales: round2(m.sales), orders: m.orders,
      impressions: m.impressions, clicks: m.clicks,
      ctr: pct(m.clicks, m.impressions), cpc: div(m.cost, m.clicks),
      cvr: pct(m.orders, m.clicks), acos: pct(m.cost, m.sales, 1),
      roas: div(m.sales, m.cost),
    });
  }

  const t = Array.from(byAg.values()).reduce(
    (acc, c) => ({
      spend: acc.spend + c.cost, sales: acc.sales + c.sales,
      orders: acc.orders + c.orders, clicks: acc.clicks + c.clicks,
      impressions: acc.impressions + c.impressions,
    }),
    { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 },
  );

  const dailySeries = Array.from(byDate.entries()).sort(([a],[b]) => a.localeCompare(b))
    .map(([date, m]) => ({ date, spend: round2(m.spend), sales: round2(m.sales), orders: m.orders, clicks: m.clicks, impressions: m.impressions }));

  const stale = dailyRows.length === 0;

  return {
    brandName, marketplace, currency, campaignId,
    dateRange: { startDate, endDate },
    adGroups: rows,
    dailySeries,
    totals: {
      spend: round2(t.spend), sales: round2(t.sales), orders: t.orders,
      clicks: t.clicks, impressions: t.impressions,
      acos: pct(t.spend, t.sales, 1), roas: div(t.sales, t.spend),
    },
    errors: { adGroups: [], reports: [] },
    freshness: {
      lastRefreshAt: refreshState?.lastRefreshAt ?? null,
      error: refreshState?.error ?? null,
      stale,
    },
  };
}

// ─── Targeting (keywords + product targets) for one ad group ────────────────

export type TargetKind = "KEYWORD" | "PRODUCT_TARGET";

export interface TargetingRow {
  id: string;            // keywordId or targetId
  kind: TargetKind;
  display: string;       // keyword text or expression description
  matchType?: "EXACT" | "PHRASE" | "BROAD";
  state: "ENABLED" | "PAUSED" | "ARCHIVED";
  bid: number;
  campaignId: string;
  adGroupId:  string;
  spend: number;
  sales: number;
  orders: number;
  impressions: number;
  clicks: number;
  ctr: number; cpc: number; cvr: number; acos: number; roas: number;
}

export interface AdGroupTargetingOverview {
  brandName:   string | null;
  marketplace: string;
  currency:    string;
  campaignId:  string;
  adGroupId:   string;
  dateRange:   { startDate: string; endDate: string };
  keywords:       TargetingRow[];
  productTargets: TargetingRow[];
  totals: { spend: number; sales: number; orders: number; clicks: number; impressions: number; acos: number; roas: number };
  errors:  { keywords?: string; productTargets?: string; report?: string };
}

export async function getTargetingForAdGroup(
  accountId: string,
  adGroupId: string,
  datePreset: string,
): Promise<AdGroupTargetingOverview> {
  const acct = getAccount(accountId);
  if (!acct) throw new Error(`Account ${accountId} not found`);

  const marketplace = acct.adsMarketplace;
  const brandName   = acct.name;
  const currency    = acct.adsMarketplace === "IN" ? "INR" : "USD";

  const { startDate, endDate } = dateRangeFromPreset(datePreset);

  // Read from store (populated by the daily refresh).
  const dailyRows = readTargetingMetrics(accountId, startDate, endDate, { adGroupId });
  const meta      = readTargetingMeta(accountId, { adGroupId });

  // Aggregate metrics per target_id
  const byId = new Map<string, { impressions: number; clicks: number; cost: number; orders: number; sales: number }>();
  for (const r of dailyRows) {
    const e = byId.get(r.targetId) ?? { impressions: 0, clicks: 0, cost: 0, orders: 0, sales: 0 };
    e.impressions += r.impressions; e.clicks += r.clicks; e.cost += r.cost; e.orders += r.orders; e.sales += r.sales;
    byId.set(r.targetId, e);
  }

  const errors: AdGroupTargetingOverview["errors"] = {};

  const keywords: TargetingRow[] = meta
    .filter((m) => m.kind === "KEYWORD")
    .map((m) => {
      const a = byId.get(m.targetId) ?? { impressions: 0, clicks: 0, cost: 0, orders: 0, sales: 0 };
      return {
        id: m.targetId, kind: "KEYWORD", display: m.display ?? `id ${m.targetId}`,
        matchType: m.matchType ?? undefined, state: m.state ?? "ARCHIVED", bid: m.bid ?? 0,
        campaignId: m.campaignId, adGroupId: m.adGroupId,
        spend: round2(a.cost), sales: round2(a.sales), orders: a.orders,
        impressions: a.impressions, clicks: a.clicks,
        ctr: pct(a.clicks, a.impressions), cpc: div(a.cost, a.clicks),
        cvr: pct(a.orders, a.clicks), acos: pct(a.cost, a.sales, 1),
        roas: div(a.sales, a.cost),
      };
    });

  const productTargets: TargetingRow[] = meta
    .filter((m) => m.kind === "PRODUCT_TARGET")
    .map((m) => {
      const a = byId.get(m.targetId) ?? { impressions: 0, clicks: 0, cost: 0, orders: 0, sales: 0 };
      return {
        id: m.targetId, kind: "PRODUCT_TARGET", display: m.display ?? "Auto target",
        state: m.state ?? "ARCHIVED", bid: m.bid ?? 0,
        campaignId: m.campaignId, adGroupId: m.adGroupId,
        spend: round2(a.cost), sales: round2(a.sales), orders: a.orders,
        impressions: a.impressions, clicks: a.clicks,
        ctr: pct(a.clicks, a.impressions), cpc: div(a.cost, a.clicks),
        cvr: pct(a.orders, a.clicks), acos: pct(a.cost, a.sales, 1),
        roas: div(a.sales, a.cost),
      };
    });

  const allRows = [...keywords, ...productTargets];
  const t = allRows.reduce(
    (acc, r) => ({
      spend: acc.spend + r.spend, sales: acc.sales + r.sales, orders: acc.orders + r.orders,
      clicks: acc.clicks + r.clicks, impressions: acc.impressions + r.impressions,
    }),
    { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 },
  );

  const result: AdGroupTargetingOverview = {
    brandName, marketplace, currency,
    campaignId: keywords[0]?.campaignId ?? productTargets[0]?.campaignId ?? "",
    adGroupId,
    dateRange: { startDate, endDate },
    keywords, productTargets,
    totals: {
      spend: round2(t.spend), sales: round2(t.sales), orders: t.orders,
      clicks: t.clicks, impressions: t.impressions,
      acos: pct(t.spend, t.sales, 1), roas: div(t.sales, t.spend),
    },
    errors,
  };

  return result;
}

function round2(n: number) { return Math.round(n * 100) / 100; }
function div(a: number, b: number) { return b > 0 ? Math.round((a / b) * 100) / 100 : 0; }
function pct(a: number, b: number, digits = 2) {
  if (b <= 0) return 0;
  const factor = Math.pow(10, digits);
  return Math.round((a / b) * 100 * factor) / factor;
}
