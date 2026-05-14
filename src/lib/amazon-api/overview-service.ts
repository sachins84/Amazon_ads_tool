/**
 * Shared overview builder used by both /api/overview (single account) and
 * /api/overview/all (cross-account aggregator). Calling this directly avoids
 * an HTTP round-trip (which otherwise hits Node's 5-min undici body timeout).
 */
import { listAllCampaigns, type UnifiedCampaign } from "./campaigns";
import { fetchAllProgramReports, type Program, type UnifiedCampaignRow } from "./reports";
import { dateRangeFromPreset } from "./transform";
import { cacheGet, cacheSet } from "@/lib/cache";
import { getAccount } from "@/lib/db/accounts";

const TTL_MS = 60 * 60 * 1000; // 1h — daily data is stable

export interface OverviewResult {
  brandName:   string | null;
  marketplace: string;
  currency:    string;
  dateRange:   { startDate: string; endDate: string };
  kpis: {
    spend:       { value: number; delta: number; positive: boolean };
    sales:       { value: number; delta: number; positive: boolean };
    orders:      { value: number; delta: number; positive: boolean };
    impressions: { value: number; delta: number; positive: boolean };
    clicks:      { value: number; delta: number; positive: boolean };
    acos:        { value: number; delta: number; positive: boolean };
    roas:        { value: number; delta: number; positive: boolean };
    ctr:         { value: number; delta: number; positive: boolean };
    cpc:         { value: number; delta: number; positive: boolean };
    cvr:         { value: number; delta: number; positive: boolean };
  };
  campaigns: {
    id: string; name: string; type: Program;
    status: "ENABLED" | "PAUSED" | "ARCHIVED";
    budget: number; portfolioId: string | null;
    spend: number; sales: number; orders: number;
    impressions: number; clicks: number;
    ctr: number; cpc: number; cvr: number; acos: number; roas: number;
  }[];
  spendByType: { name: string; code: Program; value: number; color: string }[];
  dailySeries: { date: string; spend: number; sales: number; orders: number; clicks: number; impressions: number; acos: number; roas: number }[];
  programTotals: Record<Program, { spend: number; sales: number; orders: number; clicks: number; impressions: number }>;
  errors: {
    campaigns: { program: Program; error: string }[];
    reports:   { program: Program; error: string }[];
  };
}

export async function getOverviewForAccount(accountId: string, datePreset: string): Promise<OverviewResult> {
  const acct = getAccount(accountId);
  if (!acct) throw new Error(`Account ${accountId} not found`);

  const profileId   = acct.adsProfileId;
  const marketplace = acct.adsMarketplace;
  const brandName   = acct.name;
  const currency    = acct.adsMarketplace === "IN" ? "INR" : "USD";

  const { startDate, endDate } = dateRangeFromPreset(datePreset);
  const cacheKey = `overview:v2:${accountId}:${startDate}:${endDate}`;

  const cached = cacheGet<OverviewResult>(cacheKey);
  if (cached) return cached;

  const [campaignsResult, reportsResult] = await Promise.all([
    listAllCampaigns(profileId, accountId),
    fetchAllProgramReports(profileId, startDate, endDate, accountId),
  ]);

  const result = buildOverview({
    campaigns:      campaignsResult.campaigns,
    campaignErrors: campaignsResult.errors,
    rows:           reportsResult.rows,
    reportErrors:   reportsResult.errors,
    startDate, endDate, currency, marketplace, brandName,
  });

  // Cache unless ALL three programs errored — a legit "zero spend" account
  // (no campaigns running) should still cache to avoid 5-min re-pulls every time.
  if (reportsResult.errors.length < 3) cacheSet(cacheKey, result, TTL_MS);
  return result;
}

interface BuildArgs {
  campaigns:      UnifiedCampaign[];
  campaignErrors: { program: Program; error: string }[];
  rows:           UnifiedCampaignRow[];
  reportErrors:   { program: Program; error: string }[];
  startDate: string; endDate: string;
  currency: string; marketplace: string; brandName: string | null;
}

function buildOverview(a: BuildArgs): OverviewResult {
  const byCampaign = new Map<string, {
    program: Program;
    impressions: number; clicks: number; cost: number; orders: number; sales: number;
  }>();
  const byProgram: Record<Program, { spend: number; sales: number; orders: number; clicks: number; impressions: number }> = {
    SP: { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 },
    SB: { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 },
    SD: { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 },
  };
  const byDate = new Map<string, { spend: number; sales: number; orders: number; clicks: number; impressions: number }>();

  for (const r of a.rows) {
    const c = byCampaign.get(r.campaignId) ?? {
      program: r.program,
      impressions: 0, clicks: 0, cost: 0, orders: 0, sales: 0,
    };
    c.impressions += r.impressions;
    c.clicks      += r.clicks;
    c.cost        += r.cost;
    c.orders      += r.orders;
    c.sales       += r.sales;
    byCampaign.set(r.campaignId, c);

    const p = byProgram[r.program];
    p.spend       += r.cost;
    p.sales       += r.sales;
    p.orders      += r.orders;
    p.clicks      += r.clicks;
    p.impressions += r.impressions;

    if (r.date) {
      const d = byDate.get(r.date) ?? { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 };
      d.spend       += r.cost;
      d.sales       += r.sales;
      d.orders      += r.orders;
      d.clicks      += r.clicks;
      d.impressions += r.impressions;
      byDate.set(r.date, d);
    }
  }

  const campaigns: OverviewResult["campaigns"] = a.campaigns.map((c) => {
    const m = byCampaign.get(c.campaignId);
    const spend  = m?.cost ?? 0;
    const sales  = m?.sales ?? 0;
    const clicks = m?.clicks ?? 0;
    const impr   = m?.impressions ?? 0;
    const orders = m?.orders ?? 0;
    return {
      id: c.campaignId, name: c.name, type: c.program, status: c.state,
      budget: c.dailyBudget, portfolioId: c.portfolioId ?? null,
      spend: round2(spend), sales: round2(sales), orders,
      impressions: impr, clicks,
      ctr:  pct(clicks, impr), cpc: div(spend, clicks),
      cvr:  pct(orders, clicks), acos: pct(spend, sales, 1),
      roas: div(sales, spend),
    };
  });

  const seenIds = new Set(campaigns.map((c) => c.id));
  for (const [campaignId, m] of byCampaign) {
    if (seenIds.has(campaignId)) continue;
    campaigns.push({
      id: campaignId, name: `Campaign ${campaignId}`, type: m.program,
      status: "ARCHIVED", budget: 0, portfolioId: null,
      spend: round2(m.cost), sales: round2(m.sales), orders: m.orders,
      impressions: m.impressions, clicks: m.clicks,
      ctr: pct(m.clicks, m.impressions), cpc: div(m.cost, m.clicks),
      cvr: pct(m.orders, m.clicks), acos: pct(m.cost, m.sales, 1),
      roas: div(m.sales, m.cost),
    });
  }

  const totals = Array.from(byCampaign.values()).reduce(
    (acc, c) => ({
      spend:       acc.spend + c.cost,
      sales:       acc.sales + c.sales,
      orders:      acc.orders + c.orders,
      clicks:      acc.clicks + c.clicks,
      impressions: acc.impressions + c.impressions,
    }),
    { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 },
  );

  const dailySeries = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, m]) => ({
      date,
      spend: round2(m.spend),
      sales: round2(m.sales),
      orders: m.orders,
      clicks: m.clicks,
      impressions: m.impressions,
      acos: pct(m.spend, m.sales, 1),
      roas: div(m.sales, m.spend),
    }));

  const spendByType = [
    { name: "Sponsored Products", code: "SP" as Program, value: round2(byProgram.SP.spend), color: "#6366f1" },
    { name: "Sponsored Brands",   code: "SB" as Program, value: round2(byProgram.SB.spend), color: "#8b5cf6" },
    { name: "Sponsored Display",  code: "SD" as Program, value: round2(byProgram.SD.spend), color: "#a78bfa" },
  ];

  return {
    brandName:   a.brandName,
    marketplace: a.marketplace,
    currency:    a.currency,
    dateRange:   { startDate: a.startDate, endDate: a.endDate },
    kpis: {
      spend:       { value: round2(totals.spend),       delta: 0, positive: false },
      sales:       { value: round2(totals.sales),       delta: 0, positive: true  },
      orders:      { value: totals.orders,              delta: 0, positive: true  },
      impressions: { value: totals.impressions,         delta: 0, positive: true  },
      clicks:      { value: totals.clicks,              delta: 0, positive: true  },
      acos:        { value: pct(totals.spend, totals.sales, 1), delta: 0, positive: false },
      roas:        { value: div(totals.sales, totals.spend),    delta: 0, positive: true  },
      ctr:         { value: pct(totals.clicks, totals.impressions), delta: 0, positive: true },
      cpc:         { value: div(totals.spend, totals.clicks), delta: 0, positive: false },
      cvr:         { value: pct(totals.orders, totals.clicks), delta: 0, positive: true },
    },
    campaigns,
    spendByType,
    dailySeries,
    programTotals: byProgram,
    errors: {
      campaigns: a.campaignErrors,
      reports:   a.reportErrors,
    },
  };
}

function round2(n: number) { return Math.round(n * 100) / 100; }
function div(a: number, b: number) { return b > 0 ? Math.round((a / b) * 100) / 100 : 0; }
function pct(a: number, b: number, digits = 2) {
  if (b <= 0) return 0;
  const factor = Math.pow(10, digits);
  return Math.round((a / b) * 100 * factor) / factor;
}
