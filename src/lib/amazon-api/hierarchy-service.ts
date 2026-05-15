/**
 * Hierarchy drill-down services: ad groups for a campaign, targets for an ad group.
 * Both are cached in-process (1h TTL) using the resolved date range in the key.
 */
import { fetchTargetingReport, type Program } from "./reports";
import { listSPKeywords, listSPProductTargets, type SPKeyword, type SPProductTarget } from "./targeting";
import { dateRangeFromPreset } from "./transform";
import { cacheGet, cacheSet } from "@/lib/cache";
import { getAccount } from "@/lib/db/accounts";
import { readAdGroupMetrics, readAdGroupMeta, getRefreshState } from "@/lib/db/metrics-store";

const TTL_MS = 60 * 60 * 1000;

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

  const profileId   = acct.adsProfileId;
  const marketplace = acct.adsMarketplace;
  const brandName   = acct.name;
  const currency    = acct.adsMarketplace === "IN" ? "INR" : "USD";

  const { startDate, endDate } = dateRangeFromPreset(datePreset);
  const cacheKey = `targeting:${accountId}:${adGroupId}:${startDate}:${endDate}`;
  const cached = cacheGet<AdGroupTargetingOverview>(cacheKey);
  if (cached) return cached;

  const [kwResult, ptResult, reportResult] = await Promise.allSettled([
    listSPKeywords(profileId, { adGroupIdFilter: [adGroupId] }, accountId),
    listSPProductTargets(profileId, { adGroupIdFilter: [adGroupId] }, accountId),
    fetchTargetingReport(profileId, startDate, endDate, accountId),
  ]);

  const errors: AdGroupTargetingOverview["errors"] = {};
  const kws = kwResult.status === "fulfilled" ? kwResult.value : (errors.keywords = String(kwResult.reason), [] as SPKeyword[]);
  const pts = ptResult.status === "fulfilled" ? ptResult.value : (errors.productTargets = String(ptResult.reason), [] as SPProductTarget[]);
  const rpt = reportResult.status === "fulfilled" ? reportResult.value : (errors.report = String(reportResult.reason), []);

  // Index report rows by (keywordId|targetId), filtered to this adGroup.
  const byKw = new Map<string, { impressions: number; clicks: number; cost: number; orders: number; sales: number }>();
  const byPt = new Map<string, { impressions: number; clicks: number; cost: number; orders: number; sales: number }>();
  for (const raw of rpt as Record<string, unknown>[]) {
    const rAg = String(raw.adGroupId ?? "");
    if (rAg !== adGroupId) continue;
    const kid = raw.keywordId != null ? String(raw.keywordId) : "";
    const tid = raw.targetId  != null ? String(raw.targetId)  : "";
    const cell = {
      impressions: Number(raw.impressions ?? 0),
      clicks:      Number(raw.clicks ?? 0),
      cost:        Number(raw.cost ?? 0),
      orders:      Number(raw.purchases7d ?? raw.purchases30d ?? 0),
      sales:       Number(raw.sales7d ?? raw.sales30d ?? 0),
    };
    if (kid) {
      const e = byKw.get(kid) ?? { impressions: 0, clicks: 0, cost: 0, orders: 0, sales: 0 };
      e.impressions += cell.impressions; e.clicks += cell.clicks; e.cost += cell.cost; e.orders += cell.orders; e.sales += cell.sales;
      byKw.set(kid, e);
    }
    if (tid) {
      const e = byPt.get(tid) ?? { impressions: 0, clicks: 0, cost: 0, orders: 0, sales: 0 };
      e.impressions += cell.impressions; e.clicks += cell.clicks; e.cost += cell.cost; e.orders += cell.orders; e.sales += cell.sales;
      byPt.set(tid, e);
    }
  }

  const keywords: TargetingRow[] = kws.map((k) => {
    const m = byKw.get(k.keywordId) ?? { impressions: 0, clicks: 0, cost: 0, orders: 0, sales: 0 };
    return {
      id: k.keywordId, kind: "KEYWORD", display: k.keywordText,
      matchType: k.matchType, state: k.state, bid: k.bid ?? 0,
      campaignId: k.campaignId, adGroupId: k.adGroupId,
      spend: round2(m.cost), sales: round2(m.sales), orders: m.orders,
      impressions: m.impressions, clicks: m.clicks,
      ctr: pct(m.clicks, m.impressions), cpc: div(m.cost, m.clicks),
      cvr: pct(m.orders, m.clicks), acos: pct(m.cost, m.sales, 1),
      roas: div(m.sales, m.cost),
    };
  });

  const productTargets: TargetingRow[] = pts.map((t) => {
    const m = byPt.get(t.targetId) ?? { impressions: 0, clicks: 0, cost: 0, orders: 0, sales: 0 };
    const expr = t.expression?.[0] ?? t.resolvedExpression?.[0];
    const display = expr
      ? (expr.type === "asinSameAs" ? `ASIN: ${expr.value}` : `${expr.type}${expr.value ? `: ${expr.value}` : ""}`)
      : "Auto target";
    return {
      id: t.targetId, kind: "PRODUCT_TARGET", display,
      state: t.state, bid: t.bid ?? 0,
      campaignId: t.campaignId, adGroupId: t.adGroupId,
      spend: round2(m.cost), sales: round2(m.sales), orders: m.orders,
      impressions: m.impressions, clicks: m.clicks,
      ctr: pct(m.clicks, m.impressions), cpc: div(m.cost, m.clicks),
      cvr: pct(m.orders, m.clicks), acos: pct(m.cost, m.sales, 1),
      roas: div(m.sales, m.cost),
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

  // Cache only if the report didn't fail outright.
  if (!errors.report) cacheSet(cacheKey, result, TTL_MS);
  return result;
}

function round2(n: number) { return Math.round(n * 100) / 100; }
function div(a: number, b: number) { return b > 0 ? Math.round((a / b) * 100) / 100 : 0; }
function pct(a: number, b: number, digits = 2) {
  if (b <= 0) return 0;
  const factor = Math.pow(10, digits);
  return Math.round((a / b) * 100 * factor) / factor;
}
