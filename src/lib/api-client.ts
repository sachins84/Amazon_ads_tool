/**
 * Frontend fetch helpers that call our Next.js API routes.
 * Falls back to mock data when credentials / profileId are not configured.
 */
import type { Target, OverviewKpis, SearchTermRow, SQPRow, CatalogPerformanceRow } from "./types";
export type { BrandAnalyticsData } from "./types";
import type { BrandAnalyticsData } from "./types";
import { mockKpis, mockCampaigns, mockTargets, spendByType as mockSpendByType, mockSearchTerms, mockSQP, mockCatalogPerformance } from "./mock-data";

const BASE = "";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OverviewData {
  kpis: OverviewKpis;
  campaigns: typeof mockCampaigns;
  spendByType: { name: string; value: number; color: string }[];
  _source?: "live" | "mock";
}

export interface TargetingData {
  targets: Target[];
  summary: {
    total: number;
    spend: number;
    revenue: number;
    acos: number;
    roas: number;
    orders: number;
  };
  totalCount: number;
  _source?: "live" | "mock";
}

// ─── Helper: detect unconfigured state ───────────────────────────────────────

function isMockSignal(json: { code?: string }): boolean {
  return json.code === "CONFIG_MISSING" || json.code === "MISSING_PROFILE";
}

// ─── Overview ─────────────────────────────────────────────────────────────────

export async function fetchOverview(params: {
  accountId?: string;
  profileId?: string;
  dateRange?: string;
  campaignType?: string;
} = {}): Promise<OverviewData> {
  const qs = new URLSearchParams();
  if (params.accountId)    qs.set("accountId",     params.accountId);
  if (params.profileId)    qs.set("profileId",     params.profileId);
  if (params.dateRange)    qs.set("dateRange",      params.dateRange);
  if (params.campaignType) qs.set("campaignType",   params.campaignType);

  try {
    const res  = await fetch(`${BASE}/api/overview?${qs}`);
    const json = await res.json();

    if (isMockSignal(json)) return { ...getMockOverview(), _source: "mock" };
    if (!res.ok) throw new Error(json.error ?? "Failed to fetch overview");

    return { ...json, _source: "live" };
  } catch (e) {
    // Network error (e.g. API route threw before responding) → fall back to mock
    if (e instanceof TypeError) return { ...getMockOverview(), _source: "mock" };
    throw e;
  }
}

// ─── Targeting ────────────────────────────────────────────────────────────────

export interface TargetingParams {
  accountId?: string;
  profileId?: string;
  dateRange?: string;
  search?: string;
  targetType?: string;
  matchType?: string;
  status?: string;
  campaignIds?: string[];
  bidMin?: string;
  bidMax?: string;
  acosMin?: string;
  acosMax?: string;
  spendMin?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: string;
}

export async function fetchTargeting(params: TargetingParams = {}): Promise<TargetingData> {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    if (Array.isArray(v)) v.forEach((item) => qs.append(k, item));
    else qs.set(k, String(v));
  });

  try {
    const res  = await fetch(`${BASE}/api/targeting?${qs}`);
    const json = await res.json();

    if (isMockSignal(json)) return getMockTargeting();
    if (!res.ok) throw new Error(json.error ?? "Failed to fetch targeting");

    return { ...json, _source: "live" };
  } catch (e) {
    if (e instanceof TypeError) return getMockTargeting();
    throw e;
  }
}

// ─── Sales (SP-API) ──────────────────────────────────────────────────────────

export interface SalesData {
  summary: { totalRevenue: number; totalOrders: number; totalUnits: number };
  dailySeries: { date: string; totalRevenue: number; totalOrders: number; totalUnits: number }[];
  _source?: "live" | "mock";
}

export async function fetchSales(params: {
  accountId?: string;
  marketplaceId?: string;
  dateRange?: string;
  source?: "orders" | "report";
} = {}): Promise<SalesData> {
  const qs = new URLSearchParams();
  if (params.accountId)     qs.set("accountId",     params.accountId);
  if (params.marketplaceId) qs.set("marketplaceId", params.marketplaceId);
  if (params.dateRange)     qs.set("dateRange",      params.dateRange);
  if (params.source)        qs.set("source",         params.source);

  try {
    const res  = await fetch(`${BASE}/api/sales?${qs}`);
    const json = await res.json();
    if (isMockSignal(json)) return getMockSales();
    if (!res.ok) throw new Error(json.error ?? "Failed to fetch sales");
    return { ...json, _source: "live" };
  } catch (e) {
    if (e instanceof TypeError) return getMockSales();
    throw e;
  }
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export async function updateTargetBid(
  profileId: string,
  id: string,
  type: string,
  bid: number,
  accountId?: string
): Promise<void> {
  if (!profileId && !accountId) return; // mock mode
  const res  = await fetch(`${BASE}/api/targeting/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profileId, accountId, type, bid }),
  });
  if (!res.ok) {
    const json = await res.json();
    if (isMockSignal(json)) return;
    throw new Error(json.error ?? "Bid update failed");
  }
}

export async function updateTargetStatus(
  profileId: string,
  id: string,
  type: string,
  status: string,
  accountId?: string
): Promise<void> {
  if (!profileId && !accountId) return;
  const res  = await fetch(`${BASE}/api/targeting/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profileId, accountId, type, status }),
  });
  if (!res.ok) {
    const json = await res.json();
    if (isMockSignal(json)) return;
    throw new Error(json.error ?? "Status update failed");
  }
}

export async function bulkUpdateTargets(payload: {
  profileId: string;
  accountId?: string;
  targets: { id: string; type: string }[];
  action: string;
  bidValue?: number;
  currentBids?: Record<string, number>;
  suggestedBids?: Record<string, number>;
}): Promise<void> {
  if (!payload.profileId && !payload.accountId) return;
  const res  = await fetch(`${BASE}/api/targeting/bulk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const json = await res.json();
    if (isMockSignal(json)) return;
    throw new Error(json.error ?? "Bulk update failed");
  }
}

// ─── Brand Analytics ─────────────────────────────────────────────────────────

/**
 * Fetch Brand Analytics data.
 * Fires all 3 reports in parallel and calls onUpdate progressively as each completes.
 * The returned promise resolves once all reports have been attempted.
 */
export async function fetchBrandAnalytics(params: {
  accountId?: string;
  dateRange?: string;
  onUpdate?: (data: BrandAnalyticsData) => void;
  signal?: AbortSignal;
} = {}): Promise<BrandAnalyticsData> {
  const qs = new URLSearchParams();
  if (params.accountId) qs.set("accountId", params.accountId);
  if (params.dateRange) qs.set("dateRange", params.dateRange);

  async function fetchReport<T>(report: string, key: string, extraParams?: Record<string, string>): Promise<{ data: T | null; raw: Record<string, unknown> | null }> {
    if (params.signal?.aborted) return { data: null, raw: null };
    const rqs = new URLSearchParams(qs);
    rqs.set("report", report);
    if (extraParams) Object.entries(extraParams).forEach(([k, v]) => rqs.set(k, v));
    try {
      const res = await fetch(`${BASE}/api/brand-analytics?${rqs}`, { signal: params.signal });
      const json = await res.json();
      if (isMockSignal(json)) return { data: null, raw: null };
      if (!res.ok) return { data: null, raw: null };
      return { data: json[key] as T, raw: json };
    } catch {
      return { data: null, raw: null };
    }
  }

  const live: BrandAnalyticsData = {
    searchTerms: mockSearchTerms,
    sqp: mockSQP,
    catalogPerformance: mockCatalogPerformance,
    _source: "mock",
  };

  const pushUpdate = () => {
    if (params.signal?.aborted) return;
    params.onUpdate?.({ ...live });
  };

  // Fire all 3 independently — push updates as each completes
  const catalogP = fetchReport<CatalogPerformanceRow[]>("catalog", "catalogPerformance", { compare: "true" })
    .then(({ data, raw }) => {
      if (data?.length) {
        live.catalogPerformance = data;
        live.previousCatalog = (raw?.previousPeriod as CatalogPerformanceRow[] | undefined) ?? [];
        live.weeklyTrends = (raw?.weeklyTrends as Record<string, import("./types").AsinWeeklyTrend> | undefined) ?? {};
        live.periodLabel = (raw?.periodLabel as string) ?? "WoW";
        live._source = "live";
        pushUpdate();
      }
    });
  const searchP = fetchReport<SearchTermRow[]>("search-terms", "searchTerms")
    .then(({ data }) => { if (data?.length) { live.searchTerms = data; live._source = "live"; pushUpdate(); } });
  const sqpP = fetchReport<SQPRow[]>("sqp", "sqp")
    .then(({ data }) => { if (data?.length) { live.sqp = data; live._source = "live"; pushUpdate(); } });

  await Promise.allSettled([catalogP, searchP, sqpP]);

  return { ...live };
}

// ─── Mock fallbacks ───────────────────────────────────────────────────────────

function getMockOverview(): Omit<OverviewData, "_source"> {
  return { kpis: mockKpis, campaigns: mockCampaigns, spendByType: mockSpendByType };
}

function getMockTargeting(): TargetingData {
  const targets: Target[] = mockTargets;
  const totals = {
    spend:   targets.reduce((s, t) => s + t.spend, 0),
    revenue: targets.reduce((s, t) => s + t.revenue, 0),
    orders:  targets.reduce((s, t) => s + t.orders, 0),
  };
  return {
    targets,
    summary: {
      total:   targets.length,
      spend:   Math.round(totals.spend * 100) / 100,
      revenue: Math.round(totals.revenue * 100) / 100,
      acos:    totals.revenue > 0 ? Math.round((totals.spend / totals.revenue) * 1000) / 10 : 0,
      roas:    totals.spend   > 0 ? Math.round((totals.revenue / totals.spend) * 100) / 100 : 0,
      orders:  totals.orders,
    },
    totalCount: targets.length,
    _source: "mock",
  };
}

function getMockSales(): SalesData {
  // Generate plausible mock total revenue (~2.5x ad revenue)
  const adRevenue = mockKpis.revenue.value;
  const totalRevenue = Math.round(adRevenue * 2.5);
  const totalOrders  = Math.round(mockKpis.orders.value * 2.2);
  const totalUnits   = Math.round(totalOrders * 1.4);

  // Mock daily series (30 days)
  const dailySeries = Array.from({ length: 30 }, (_, i) => {
    const d = new Date("2026-03-25T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - (29 - i));
    const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
    const day   = d.getUTCDate();
    const rev   = Math.round((totalRevenue / 30) * (0.7 + Math.sin(i * 0.4) * 0.3 + 0.3));
    return { date: `${month} ${day}`, totalRevenue: rev, totalOrders: Math.round(rev / 55), totalUnits: Math.round(rev / 38) };
  });

  return {
    summary: { totalRevenue, totalOrders, totalUnits },
    dailySeries,
    _source: "mock",
  };
}

function getMockBrandAnalytics(): BrandAnalyticsData {
  return {
    searchTerms: mockSearchTerms,
    sqp: mockSQP,
    catalogPerformance: mockCatalogPerformance,
    _source: "mock",
  };
}
