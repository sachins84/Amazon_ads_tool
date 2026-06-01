/**
 * Overview builder — reads from the persistent metrics store (campaign_metrics_daily
 * + campaign_meta), NOT directly from Amazon. The refresh-service is the only
 * thing that hits Amazon for daily reports.
 */
import { dateRangeFromPreset } from "./transform";
import { getAccount } from "@/lib/db/accounts";
import {
  readCampaignMetrics, readCampaignMeta, getRefreshState, campaignMetricsCoverage,
  readBidRecommendations,
} from "@/lib/db/metrics-store";
import { getDb } from "@/lib/db";
import type { Program } from "./reports";
import { inferIntent, type Intent } from "./intent";

export type Bucket = "SCALE_UP" | "SCALE_DOWN" | "PAUSE" | "BID_UP" | "BID_DOWN" | "HOLD";

/** Returns the latest PENDING suggestion bucket per campaign, plus a rollup
 *  of pending suggestion-buckets nested under each campaign (so a campaign
 *  whose own suggestion is HOLD can still surface "5 child SCALE_DOWNs"). */
function loadCampaignBuckets(accountId: string): Map<string, { ownBucket: Bucket | null; childBuckets: Partial<Record<Bucket, number>> }> {
  const own = getDb().prepare(`
    SELECT s.target_id, s.bucket
    FROM suggestions s
    WHERE s.account_id = ?
      AND s.target_type = 'CAMPAIGN'
      AND s.status = 'PENDING'
      AND s.bucket IS NOT NULL
    GROUP BY s.target_id
    HAVING MAX(s.created_at)
  `).all(accountId) as Array<{ target_id: string; bucket: string }>;

  const child = getDb().prepare(`
    SELECT campaign_id, bucket, COUNT(*) AS n FROM (
      SELECT ag.campaign_id, s.bucket
      FROM suggestions s
      JOIN adgroup_meta ag ON ag.account_id = s.account_id AND ag.adgroup_id = s.target_id
      WHERE s.account_id = ? AND s.status = 'PENDING' AND s.target_type = 'AD_GROUP' AND s.bucket IS NOT NULL
      UNION ALL
      SELECT tm.campaign_id, s.bucket
      FROM suggestions s
      JOIN targeting_meta tm ON tm.account_id = s.account_id AND tm.target_id = s.target_id
      WHERE s.account_id = ? AND s.status = 'PENDING' AND s.target_type IN ('KEYWORD','PRODUCT_TARGET') AND s.bucket IS NOT NULL
    )
    GROUP BY campaign_id, bucket
  `).all(accountId, accountId) as Array<{ campaign_id: string; bucket: string; n: number }>;

  const out = new Map<string, { ownBucket: Bucket | null; childBuckets: Partial<Record<Bucket, number>> }>();
  for (const r of own) {
    const cur = out.get(r.target_id) ?? { ownBucket: null, childBuckets: {} };
    cur.ownBucket = r.bucket as Bucket;
    out.set(r.target_id, cur);
  }
  for (const r of child) {
    const cur = out.get(r.campaign_id) ?? { ownBucket: null, childBuckets: {} };
    cur.childBuckets[r.bucket as Bucket] = (cur.childBuckets[r.bucket as Bucket] ?? 0) + r.n;
    out.set(r.campaign_id, cur);
  }
  return out;
}

/** Previous-period metrics attached to each row. Used by the UI to render deltas. */
export interface PrevMetrics {
  spend: number; sales: number; orders: number;
  impressions: number; clicks: number;
  ctr: number; cpc: number; cvr: number; acos: number; roas: number;
}

export interface OverviewResult {
  brandName:   string | null;
  marketplace: string;
  currency:    string;
  dateRange:   { startDate: string; endDate: string };
  kpis: {
    spend:       { value: number; prev?: number; delta: number; positive: boolean };
    sales:       { value: number; prev?: number; delta: number; positive: boolean };
    orders:      { value: number; prev?: number; delta: number; positive: boolean };
    impressions: { value: number; prev?: number; delta: number; positive: boolean };
    clicks:      { value: number; prev?: number; delta: number; positive: boolean };
    acos:        { value: number; prev?: number; delta: number; positive: boolean };
    roas:        { value: number; prev?: number; delta: number; positive: boolean };
    ctr:         { value: number; prev?: number; delta: number; positive: boolean };
    cpc:         { value: number; prev?: number; delta: number; positive: boolean };
    cvr:         { value: number; prev?: number; delta: number; positive: boolean };
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
    /** Impression-weighted Top-of-Search impression share over the window (0..100). Null if Amazon didn't report TOS_IS. */
    topOfSearchIS: number | null;
    /** Median Amazon-suggested bid across the campaign's ENABLED targets. Null if no bid recs are cached yet. */
    suggestedBidMedian: number | null;
    /** Median current bid across ENABLED targets (kept alongside suggested so the UI can show the gap inline). */
    currentBidMedian: number | null;
    /** Budget utilization = spend / (days × dailyBudget) × 100. Null when budget is 0/unknown. */
    budgetUtilization: number | null;
    /** Latest PENDING AI-suggestion bucket for this campaign — null when none. */
    bucket: Bucket | null;
    /** Counts of PENDING suggestions one level down (ad-groups, keywords, targets). */
    childBuckets: Partial<Record<Bucket, number>>;
    /** Equal-length previous period totals + derived metrics. Undefined when no prev data exists. */
    prev?: PrevMetrics;
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
    /** Impression-weighted sum of top_of_search_is (divide by tosImpr at the end). */
    tosWeighted: number;
    /** Impressions that contributed to tosWeighted (rows where top_of_search_is was non-null). */
    tosImpr: number;
  }>();
  const byProgram: Record<Program, { spend: number; sales: number; orders: number; clicks: number; impressions: number }> = {
    SP: zero(), SB: zero(), SD: zero(),
  };
  const byDate = new Map<string, { spend: number; sales: number; orders: number; clicks: number; impressions: number }>();

  for (const r of dailyRows) {
    const c = byCampaign.get(r.campaignId) ?? { program: r.program, impressions: 0, clicks: 0, cost: 0, orders: 0, sales: 0, tosWeighted: 0, tosImpr: 0 };
    c.impressions += r.impressions; c.clicks += r.clicks; c.cost += r.cost; c.orders += r.orders; c.sales += r.sales;
    if (r.topOfSearchIS != null && r.impressions > 0) {
      c.tosWeighted += r.topOfSearchIS * r.impressions;
      c.tosImpr     += r.impressions;
    }
    byCampaign.set(r.campaignId, c);

    const p = byProgram[r.program];
    p.spend += r.cost; p.sales += r.sales; p.orders += r.orders; p.clicks += r.clicks; p.impressions += r.impressions;

    const d = byDate.get(r.date) ?? { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 };
    d.spend += r.cost; d.sales += r.sales; d.orders += r.orders; d.clicks += r.clicks; d.impressions += r.impressions;
    byDate.set(r.date, d);
  }

  // Bid recommendations rolled up to campaign-level median (over ENABLED targets only).
  const bidRecs = readBidRecommendations(accountId);
  const recsByCampaign = new Map<string, number[]>();
  for (const r of bidRecs) {
    if (r.bidMedian == null) continue;
    const arr = recsByCampaign.get(r.campaignId) ?? [];
    arr.push(r.bidMedian);
    recsByCampaign.set(r.campaignId, arr);
  }

  // Current bids rolled up similarly so the UI can show "you're bidding X vs
  // suggested Y" without a second query.
  const currentBidsByCampaign = new Map<string, number[]>();
  {
    interface Row { campaign_id: string; bid: number | null }
    const rows = getDb()
      .prepare("SELECT campaign_id, bid FROM targeting_meta WHERE account_id = ? AND state = 'ENABLED' AND bid IS NOT NULL")
      .all(accountId) as Row[];
    for (const r of rows) {
      if (r.bid == null) continue;
      const arr = currentBidsByCampaign.get(r.campaign_id) ?? [];
      arr.push(r.bid);
      currentBidsByCampaign.set(r.campaign_id, arr);
    }
  }

  const windowDays = Math.max(1, daysInclusive(startDate, endDate));

  // Merge with metadata for the campaign rows.
  const metaById = new Map(meta.map((m) => [m.campaignId, m]));
  const campaigns: OverviewResult["campaigns"] = [];
  const seen = new Set<string>();
  const bucketsById = loadCampaignBuckets(accountId);

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
    const b = bucketsById.get(m.campaignId);
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
      topOfSearchIS:      agg && agg.tosImpr > 0 ? Math.round((agg.tosWeighted / agg.tosImpr) * 10) / 10 : null,
      suggestedBidMedian: round2OrNull(median(recsByCampaign.get(m.campaignId))),
      currentBidMedian:   round2OrNull(median(currentBidsByCampaign.get(m.campaignId))),
      budgetUtilization:  m.dailyBudget && m.dailyBudget > 0
        ? Math.round((spend / (m.dailyBudget * windowDays)) * 1000) / 10
        : null,
      bucket: b?.ownBucket ?? null,
      childBuckets: b?.childBuckets ?? {},
    });
    seen.add(m.campaignId);
  }

  // Surface daily rows that don't have a meta entry (campaign archived since refresh).
  for (const [campaignId, agg] of byCampaign) {
    if (seen.has(campaignId)) continue;
    const name = `Campaign ${campaignId}`;
    const b = bucketsById.get(campaignId);
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
      topOfSearchIS:      agg.tosImpr > 0 ? Math.round((agg.tosWeighted / agg.tosImpr) * 10) / 10 : null,
      suggestedBidMedian: round2OrNull(median(recsByCampaign.get(campaignId))),
      currentBidMedian:   round2OrNull(median(currentBidsByCampaign.get(campaignId))),
      budgetUtilization:  null,
      bucket: b?.ownBucket ?? null,
      childBuckets: b?.childBuckets ?? {},
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

  // ── Previous period of equal length (for KPI deltas) ───────────────────
  const { startDate: prevStart, endDate: prevEnd } = prevPeriodFromCurrent(startDate, endDate);
  const prevRows = readCampaignMetrics(accountId, prevStart, prevEnd);

  // Per-campaign prev aggregation — attach to each campaign row for the UI.
  const prevByCampaign = new Map<string, { spend: number; sales: number; orders: number; impressions: number; clicks: number }>();
  for (const r of prevRows) {
    const e = prevByCampaign.get(r.campaignId) ?? { spend: 0, sales: 0, orders: 0, impressions: 0, clicks: 0 };
    e.spend += r.cost; e.sales += r.sales; e.orders += r.orders;
    e.impressions += r.impressions; e.clicks += r.clicks;
    prevByCampaign.set(r.campaignId, e);
  }
  // Decorate each campaign row with its prev block.
  for (const c of campaigns) {
    const p = prevByCampaign.get(c.id);
    if (!p) continue;
    c.prev = {
      spend: round2(p.spend), sales: round2(p.sales), orders: p.orders,
      impressions: p.impressions, clicks: p.clicks,
      ctr:  pct(p.clicks, p.impressions),
      cpc:  div(p.spend, p.clicks),
      cvr:  pct(p.orders, p.clicks),
      acos: pct(p.spend, p.sales, 1),
      roas: div(p.sales, p.spend),
    };
  }

  const prevTotals = prevRows.reduce(
    (acc, r) => ({
      spend:       acc.spend + r.cost,
      sales:       acc.sales + r.sales,
      orders:      acc.orders + r.orders,
      clicks:      acc.clicks + r.clicks,
      impressions: acc.impressions + r.impressions,
    }),
    { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 },
  );
  const prevAcos = pct(prevTotals.spend, prevTotals.sales, 1);
  const prevRoas = div(prevTotals.sales, prevTotals.spend);
  const prevCtr  = pct(prevTotals.clicks, prevTotals.impressions);
  const prevCpc  = div(prevTotals.spend, prevTotals.clicks);
  const prevCvr  = pct(prevTotals.orders, prevTotals.clicks);

  return {
    brandName, marketplace, currency,
    dateRange: { startDate, endDate },
    kpis: {
      spend:       { value: round2(totals.spend),                       prev: round2(prevTotals.spend),       delta: delta(totals.spend,       prevTotals.spend),       positive: false },
      sales:       { value: round2(totals.sales),                       prev: round2(prevTotals.sales),       delta: delta(totals.sales,       prevTotals.sales),       positive: true  },
      orders:      { value: totals.orders,                              prev: prevTotals.orders,              delta: delta(totals.orders,      prevTotals.orders),      positive: true  },
      impressions: { value: totals.impressions,                         prev: prevTotals.impressions,         delta: delta(totals.impressions, prevTotals.impressions), positive: true  },
      clicks:      { value: totals.clicks,                              prev: prevTotals.clicks,              delta: delta(totals.clicks,      prevTotals.clicks),      positive: true  },
      acos:        { value: pct(totals.spend, totals.sales, 1),         prev: prevAcos,                       delta: delta(pct(totals.spend, totals.sales, 1),         prevAcos), positive: false },
      roas:        { value: div(totals.sales, totals.spend),            prev: prevRoas,                       delta: delta(div(totals.sales, totals.spend),            prevRoas), positive: true  },
      ctr:         { value: pct(totals.clicks, totals.impressions),     prev: prevCtr,                        delta: delta(pct(totals.clicks, totals.impressions),     prevCtr),  positive: true  },
      cpc:         { value: div(totals.spend, totals.clicks),           prev: prevCpc,                        delta: delta(div(totals.spend, totals.clicks),           prevCpc),  positive: false },
      cvr:         { value: pct(totals.orders, totals.clicks),          prev: prevCvr,                        delta: delta(pct(totals.orders, totals.clicks),          prevCvr),  positive: true  },
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

/** Returns the period of equal length immediately before [start, end] inclusive. */
export function prevPeriodFromCurrent(start: string, end: string): { startDate: string; endDate: string } {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const s = new Date(start);
  const e = new Date(end);
  const dayMs = 86_400_000;
  const len = Math.max(1, Math.round((e.getTime() - s.getTime()) / dayMs) + 1);
  const prevEnd = new Date(s.getTime() - dayMs);
  const prevStart = new Date(prevEnd.getTime() - (len - 1) * dayMs);
  return { startDate: fmt(prevStart), endDate: fmt(prevEnd) };
}

/** Percent change current vs previous. Returns 0 if previous is 0 (no baseline). */
function delta(current: number, previous: number): number {
  if (!previous || previous === 0) return 0;
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  return Math.round(pct * 10) / 10;
}

function round2(n: number) { return Math.round(n * 100) / 100; }
function round2OrNull(n: number | null): number | null { return n == null ? null : Math.round(n * 100) / 100; }
function div(a: number, b: number) { return b > 0 ? Math.round((a / b) * 100) / 100 : 0; }
function pct(a: number, b: number, digits = 2) {
  if (b <= 0) return 0;
  const factor = Math.pow(10, digits);
  return Math.round((a / b) * 100 * factor) / factor;
}

function median(values: number[] | undefined): number | null {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function daysInclusive(start: string, end: string): number {
  const s = new Date(start + "T00:00:00Z").getTime();
  const e = new Date(end   + "T00:00:00Z").getTime();
  return Math.round((e - s) / 86_400_000) + 1;
}
