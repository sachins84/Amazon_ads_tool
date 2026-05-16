/**
 * Overview builder — reads from the persistent metrics store (campaign_metrics_daily
 * + campaign_meta), NOT directly from Amazon. The refresh-service is the only
 * thing that hits Amazon for daily reports.
 */
import { dateRangeFromPreset } from "./transform";
import { getAccount } from "@/lib/db/accounts";
import {
  readCampaignMetrics, readCampaignMeta, getRefreshState, campaignMetricsCoverage,
} from "@/lib/db/metrics-store";
import type { Program } from "./reports";
import { inferIntent, type Intent } from "./intent";

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
    intent: Intent;
    targetingType?: "MANUAL" | "AUTO";
    spend: number; sales: number; orders: number;
    impressions: number; clicks: number;
    ctr: number; cpc: number; cvr: number; acos: number; roas: number;
  }[];
  spendByType: { name: string; code: Program; value: number; color: string }[];
  dailySeries: { date: string; spend: number; sales: number; orders: number; clicks: number; impressions: number; acos: number; roas: number }[];
  programTotals: Record<Program, { spend: number; sales: number; orders: number; clicks: number; impressions: number }>;
  /** Status info so the UI can tell users when data is empty or stale. */
  freshness: {
    lastRefreshAt: string | null;
    windowStart:   string | null;
    windowEnd:     string | null;
    error:         string | null;
    rowCount:      number;
    coverageMin:   string | null;
    coverageMax:   string | null;
    stale:         boolean; // true if cache is empty for the requested range
  };
}

export async function getOverviewForAccount(
  accountId: string, datePreset: string,
): Promise<OverviewResult> {
  const acct = getAccount(accountId);
  if (!acct) throw new Error(`Account ${accountId} not found`);

  const marketplace = acct.adsMarketplace;
  const brandName   = acct.name;
  const currency    = acct.adsMarketplace === "IN" ? "INR" : "USD";

  const { startDate, endDate } = dateRangeFromPreset(datePreset);

  // Read from store
  const dailyRows = readCampaignMetrics(accountId, startDate, endDate);
  const meta      = readCampaignMeta(accountId);
  const refreshState = getRefreshState(accountId, "campaigns");
  const coverage  = campaignMetricsCoverage(accountId);

  // Aggregate
  const byCampaign = new Map<string, {
    program: Program;
    impressions: number; clicks: number; cost: number; orders: number; sales: number;
  }>();
  const byProgram: Record<Program, { spend: number; sales: number; orders: number; clicks: number; impressions: number }> = {
    SP: zero(), SB: zero(), SD: zero(),
  };
  const byDate = new Map<string, { spend: number; sales: number; orders: number; clicks: number; impressions: number }>();

  for (const r of dailyRows) {
    const c = byCampaign.get(r.campaignId) ?? { program: r.program, impressions: 0, clicks: 0, cost: 0, orders: 0, sales: 0 };
    c.impressions += r.impressions; c.clicks += r.clicks; c.cost += r.cost; c.orders += r.orders; c.sales += r.sales;
    byCampaign.set(r.campaignId, c);

    const p = byProgram[r.program];
    p.spend += r.cost; p.sales += r.sales; p.orders += r.orders; p.clicks += r.clicks; p.impressions += r.impressions;

    const d = byDate.get(r.date) ?? { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 };
    d.spend += r.cost; d.sales += r.sales; d.orders += r.orders; d.clicks += r.clicks; d.impressions += r.impressions;
    byDate.set(r.date, d);
  }

  // Merge with metadata for the campaign rows.
  const metaById = new Map(meta.map((m) => [m.campaignId, m]));
  const campaigns: OverviewResult["campaigns"] = [];
  const seen = new Set<string>();

  for (const m of meta) {
    const agg = byCampaign.get(m.campaignId);
    const spend  = agg?.cost  ?? 0;
    const sales  = agg?.sales ?? 0;
    const clicks = agg?.clicks ?? 0;
    const impr   = agg?.impressions ?? 0;
    const orders = agg?.orders ?? 0;
    const name   = m.name ?? `Campaign ${m.campaignId}`;
    // Auto-targeting SP campaigns are inherently AUTO intent.
    const intent = m.targetingType === "AUTO" ? "AUTO" : inferIntent(name);
    campaigns.push({
      id: m.campaignId,
      name,
      type: m.program,
      status: m.state ?? "ARCHIVED",
      budget: m.dailyBudget ?? 0,
      portfolioId: m.portfolioId,
      intent,
      targetingType: m.targetingType ?? undefined,
      spend: round2(spend), sales: round2(sales), orders,
      impressions: impr, clicks,
      ctr: pct(clicks, impr), cpc: div(spend, clicks),
      cvr: pct(orders, clicks), acos: pct(spend, sales, 1),
      roas: div(sales, spend),
    });
    seen.add(m.campaignId);
  }

  // Surface daily rows that don't have a meta entry (campaign archived since refresh).
  for (const [campaignId, agg] of byCampaign) {
    if (seen.has(campaignId)) continue;
    const name = `Campaign ${campaignId}`;
    campaigns.push({
      id: campaignId,
      name,
      type: agg.program,
      status: "ARCHIVED",
      budget: 0, portfolioId: null,
      intent: "OTHER",
      spend: round2(agg.cost), sales: round2(agg.sales), orders: agg.orders,
      impressions: agg.impressions, clicks: agg.clicks,
      ctr: pct(agg.clicks, agg.impressions), cpc: div(agg.cost, agg.clicks),
      cvr: pct(agg.orders, agg.clicks), acos: pct(agg.cost, agg.sales, 1),
      roas: div(agg.sales, agg.cost),
    });
  }

  const totals = Array.from(byCampaign.values()).reduce(
    (acc, c) => ({
      spend: acc.spend + c.cost, sales: acc.sales + c.sales, orders: acc.orders + c.orders,
      clicks: acc.clicks + c.clicks, impressions: acc.impressions + c.impressions,
    }),
    { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 },
  );

  const dailySeries = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, m]) => ({
      date,
      spend: round2(m.spend), sales: round2(m.sales),
      orders: m.orders, clicks: m.clicks, impressions: m.impressions,
      acos: pct(m.spend, m.sales, 1), roas: div(m.sales, m.spend),
    }));

  const spendByType = [
    { name: "Sponsored Products", code: "SP" as Program, value: round2(byProgram.SP.spend), color: "#6366f1" },
    { name: "Sponsored Brands",   code: "SB" as Program, value: round2(byProgram.SB.spend), color: "#8b5cf6" },
    { name: "Sponsored Display",  code: "SD" as Program, value: round2(byProgram.SD.spend), color: "#a78bfa" },
  ];

  // "Stale" = no rows at all OR the requested end date is past the stored coverage.
  const stale = dailyRows.length === 0
    || coverage.max == null
    || endDate > coverage.max;

  return {
    brandName, marketplace, currency,
    dateRange: { startDate, endDate },
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
    freshness: {
      lastRefreshAt: refreshState?.lastRefreshAt ?? null,
      windowStart:   refreshState?.windowStart   ?? null,
      windowEnd:     refreshState?.windowEnd     ?? null,
      error:         refreshState?.error         ?? null,
      rowCount:      coverage.rowCount,
      coverageMin:   coverage.min,
      coverageMax:   coverage.max,
      stale,
    },
  };
}

function zero() { return { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 }; }
function round2(n: number) { return Math.round(n * 100) / 100; }
function div(a: number, b: number) { return b > 0 ? Math.round((a / b) * 100) / 100 : 0; }
function pct(a: number, b: number, digits = 2) {
  if (b <= 0) return 0;
  const factor = Math.pow(10, digits);
  return Math.round((a / b) * 100 * factor) / factor;
}
