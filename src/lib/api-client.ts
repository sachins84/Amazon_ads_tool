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

// New v2 overview response. Keep the older OverviewData as a subset to stay
// backwards-compatible with mock fallback callers.
export type Program = "SP" | "SB" | "SD";

export interface OverviewCampaignRow {
  id: string;
  name: string;
  type: Program;
  status: "ENABLED" | "PAUSED" | "ARCHIVED";
  budget: number;
  portfolioId: string | null;
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

export interface OverviewDailyPoint {
  date: string;
  spend: number;
  sales: number;
  orders: number;
  clicks: number;
  impressions: number;
  acos: number;
  roas: number;
}

export interface OverviewData {
  brandName?: string | null;
  marketplace?: string;
  currency?: string;
  dateRange?: { startDate: string; endDate: string };
  kpis: OverviewKpis & {
    sales?: { value: number; delta: number; positive: boolean };
  };
  campaigns: OverviewCampaignRow[] | typeof mockCampaigns;
  spendByType: { name: string; code?: Program; value: number; color: string }[];
  dailySeries?: OverviewDailyPoint[];
  programTotals?: Record<Program, { spend: number; sales: number; orders: number; clicks: number; impressions: number }>;
  errors?: { campaigns: { program: Program; error: string }[]; reports: { program: Program; error: string }[] };
  freshness?: {
    lastRefreshAt: string | null;
    windowStart:   string | null;
    windowEnd:     string | null;
    error:         string | null;
    rowCount:      number;
    coverageMin:   string | null;
    coverageMax:   string | null;
    stale:         boolean;
  };
  _source?: "live" | "mock";
}

export interface AllBrandsResponse {
  accounts: {
    accountId: string;
    name: string;
    color: string;
    marketplace: string;
    currency: string;
    profileId: string;
    spend: number; sales: number; orders: number;
    roas: number; acos: number; ctr: number; cpc: number;
    spendByType: { name: string; code?: string; value: number; color: string }[];
    dailySeries: { date: string; spend: number; sales: number }[];
    activeCampaigns: number;
    error?: string;
  }[];
  byCurrency: Record<string, {
    currency: string;
    spend: number; sales: number; orders: number;
    roas: number; acos: number;
    accounts: number;
  }>;
  errors: { accountId: string; name: string; error: string }[];
  dateRange?: string;
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

/**
 * Queue an inline action as a PENDING suggestion (review then apply via /suggestions).
 */
export async function queueSuggestion(input: {
  accountId: string;
  targetType: "CAMPAIGN" | "AD_GROUP" | "KEYWORD" | "PRODUCT_TARGET";
  targetId: string;
  targetName?: string;
  program?: "SP" | "SB" | "SD";
  actionType: "PAUSE" | "ENABLE" | "SET_BID" | "SET_BUDGET";
  actionValue?: number;
  currentValue?: number;
  reason?: string;
  apply?: boolean;
}): Promise<{ success: boolean; queued?: boolean; applied?: boolean; suggestionId?: string; message?: string; error?: string }> {
  const res = await fetch(`/api/suggestions/queue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return res.json();
}

/** Trigger an incremental Amazon refresh for an account (default 14 days). */
export async function refreshAccountMetrics(params: { accountId?: string; all?: boolean; days?: number } = {}): Promise<{ refreshed?: number; results?: unknown[]; durationMs?: number; campaignRowsUpserted?: number; adGroupRowsUpserted?: number; error?: string }> {
  const qs = new URLSearchParams();
  if (params.accountId) qs.set("accountId", params.accountId);
  if (params.all)       qs.set("all", "true");
  if (params.days)      qs.set("days", String(params.days));
  const res  = await fetch(`/api/admin/refresh?${qs}`, { method: "POST" });
  const json = await res.json();
  return json;
}

export async function fetchAllBrands(params: { dateRange?: string } = {}): Promise<AllBrandsResponse> {
  const qs = new URLSearchParams();
  if (params.dateRange) qs.set("dateRange", params.dateRange);
  const res  = await fetch(`${BASE}/api/overview/all?${qs}`);
  if (!res.ok) throw new Error(`fetchAllBrands HTTP ${res.status}`);
  return res.json() as Promise<AllBrandsResponse>;
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

  // Generate mock weekly trends so magnifying glass works in mock mode
  const mockWeekly: Record<string, import("./types").AsinWeeklyTrend> = {};
  for (const r of mockCatalogPerformance) {
    if (!mockWeekly[r.asin]) {
      const vary = (base: number) => [0.85, 0.92, 0.96, 1].map((f) => Math.round(base * f * (0.9 + Math.random() * 0.2)));
      mockWeekly[r.asin] = {
        impressions: vary(r.impressions),
        clicks: vary(r.clicks),
        addToCarts: vary(r.addToCarts),
        purchases: vary(r.purchases),
      };
    }
  }

  const live: BrandAnalyticsData = {
    searchTerms: mockSearchTerms,
    sqp: mockSQP,
    catalogPerformance: mockCatalogPerformance,
    weeklyTrends: mockWeekly,
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
