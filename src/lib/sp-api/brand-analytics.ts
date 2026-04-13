/**
 * SP-API Brand Analytics Reports.
 *
 * Three report types:
 * 1. GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT     – SFR + top 3 clicked/purchased ASINs per keyword
 * 2. GET_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT – brand-level keyword market share
 * 3. GET_BRAND_ANALYTICS_SEARCH_CATALOG_PERFORMANCE_REPORT – ASIN × keyword performance
 *
 * All use the SP-API Reports 2021-06-30 endpoint: create → poll → download.
 */
import { spRequest } from "./client";
import { accountSpRequest } from "../amazon-api/account-client";
import type { SearchTermRow, SQPRow, CatalogPerformanceRow } from "../types";

// ─── SP-API report plumbing ──────────────────────────────────────────────────

type ReportStatus = "IN_QUEUE" | "IN_PROGRESS" | "DONE" | "FATAL" | "CANCELLED";

interface CreateReportRes  { reportId: string }
interface ReportStatusRes  { reportId: string; processingStatus: ReportStatus; reportDocumentId?: string }
interface ReportDocRes     { reportDocumentId: string; url: string; compressionAlgorithm?: string }

async function spReq<T>(
  accountId: string | undefined,
  path: string,
  opts?: { method?: string; body?: unknown }
): Promise<T> {
  if (accountId) return accountSpRequest<T>(accountId, path, opts);
  return spRequest<T>(path, opts);
}

async function createReport(
  accountId: string | undefined,
  marketplaceId: string,
  reportType: string,
  startDate: string,
  endDate: string,
  reportOptions?: Record<string, string>
): Promise<string> {
  const res = await spReq<CreateReportRes>(accountId, "/reports/2021-06-30/reports", {
    method: "POST",
    body: {
      reportType,
      marketplaceIds: [marketplaceId],
      dataStartTime: `${startDate}T00:00:00Z`,
      dataEndTime:   `${endDate}T23:59:59Z`,
      ...(reportOptions ? { reportOptions } : {}),
    },
  });
  return res.reportId;
}

async function pollAndDownload<T>(
  accountId: string | undefined,
  reportId: string
): Promise<T> {
  const MAX_POLLS = 20;
  for (let i = 0; i < MAX_POLLS; i++) {
    const status = await spReq<ReportStatusRes>(
      accountId,
      `/reports/2021-06-30/reports/${reportId}`
    );

    if (status.processingStatus === "DONE" && status.reportDocumentId) {
      const doc = await spReq<ReportDocRes>(
        accountId,
        `/reports/2021-06-30/documents/${status.reportDocumentId}`
      );
      return downloadJson<T>(doc.url, doc.compressionAlgorithm);
    }

    if (status.processingStatus === "FATAL" || status.processingStatus === "CANCELLED") {
      throw new Error(`Brand analytics report ${reportId} failed: ${status.processingStatus}`);
    }

    await new Promise((r) => setTimeout(r, 15_000));
  }
  throw new Error(`Brand analytics report ${reportId} timed out`);
}

async function downloadJson<T>(url: string, compression?: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Report download failed: ${res.status}`);

  let text: string;
  if (compression === "GZIP") {
    const { gunzipSync } = await import("zlib");
    const buf = await res.arrayBuffer();
    text = gunzipSync(Buffer.from(buf)).toString("utf-8");
  } else {
    text = await res.text();
  }
  return JSON.parse(text) as T;
}

// ─── Search Terms Report ─────────────────────────────────────────────────────

interface RawSearchTermRow {
  searchTerm: string;
  searchFrequencyRank: number;
  clickedAsin?: string;
  clickShareRank?: number;
  clickShare?: number;
  conversionShare?: number;
  departmentName?: string;
  /* Amazon returns an array of 1–3 ASINs; structure varies by marketplace */
  clickedAsinList?: {
    asin: string;
    clickShare: number;
    conversionShare: number;
  }[];
}

function normaliseSearchTerms(raw: { dataByDepartmentAndSearchTerm?: RawSearchTermRow[] } | RawSearchTermRow[]): SearchTermRow[] {
  const rows = Array.isArray(raw) ? raw : (raw.dataByDepartmentAndSearchTerm ?? []);
  return rows.map((r) => {
    const list = r.clickedAsinList ?? [];
    return {
      searchTerm:          r.searchTerm,
      searchFrequencyRank: r.searchFrequencyRank,
      asin1:               list[0]?.asin ?? "",
      asin1ClickShare:     list[0]?.clickShare ?? 0,
      asin1ConversionShare: list[0]?.conversionShare ?? 0,
      asin2:               list[1]?.asin ?? "",
      asin2ClickShare:     list[1]?.clickShare ?? 0,
      asin2ConversionShare: list[1]?.conversionShare ?? 0,
      asin3:               list[2]?.asin ?? "",
      asin3ClickShare:     list[2]?.clickShare ?? 0,
      asin3ConversionShare: list[2]?.conversionShare ?? 0,
    };
  });
}

export async function fetchSearchTermsReport(
  marketplaceId: string,
  startDate: string,
  endDate: string,
  accountId?: string
): Promise<SearchTermRow[]> {
  const reportId = await createReport(
    accountId, marketplaceId,
    "GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT",
    startDate, endDate,
    { reportPeriod: "WEEK" }
  );
  const raw = await pollAndDownload<Record<string, unknown>>(accountId, reportId);
  return normaliseSearchTerms(raw as Parameters<typeof normaliseSearchTerms>[0]);
}

// ─── Search Query Performance (SQP) Report ───────────────────────────────────

interface RawSQPRow {
  queryString?: string;
  searchQuery?: string;
  totalQueryCount?: number;
  totalSearchVolume?: number;
  impressionsTotal?: number;
  impressions?: number;
  clicksTotal?: number;
  clicks?: number;
  purchasesTotal?: number;
  purchases?: number;
  impressionShare?: number;
  clickShare?: number;
  purchaseShare?: number;
}

function normaliseSQP(raw: { searchQueryPerformance?: RawSQPRow[] } | RawSQPRow[]): SQPRow[] {
  const rows = Array.isArray(raw) ? raw : (raw.searchQueryPerformance ?? []);
  return rows.map((r) => ({
    searchQuery:       r.queryString ?? r.searchQuery ?? "",
    totalSearchVolume: r.totalQueryCount ?? r.totalSearchVolume ?? 0,
    impressions:       r.impressionsTotal ?? r.impressions ?? 0,
    clicks:            r.clicksTotal ?? r.clicks ?? 0,
    purchases:         r.purchasesTotal ?? r.purchases ?? 0,
    impressionShare:   r.impressionShare ?? 0,
    clickShare:        r.clickShare ?? 0,
    purchaseShare:     r.purchaseShare ?? 0,
  }));
}

export async function fetchSQPReport(
  marketplaceId: string,
  startDate: string,
  endDate: string,
  accountId?: string
): Promise<SQPRow[]> {
  const reportId = await createReport(
    accountId, marketplaceId,
    "GET_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT",
    startDate, endDate
  );
  const raw = await pollAndDownload<Record<string, unknown>>(accountId, reportId);
  return normaliseSQP(raw as Parameters<typeof normaliseSQP>[0]);
}

// ─── Search Catalog Performance Report ───────────────────────────────────────

interface RawCatalogRow {
  asin?: string;
  productTitle?: string;
  searchQuery?: string;
  queryString?: string;
  impressions?: number;
  clicks?: number;
  addToCarts?: number;
  cartAdds?: number;
  purchases?: number;
}

function normaliseCatalog(raw: { searchCatalogPerformance?: RawCatalogRow[] } | RawCatalogRow[]): CatalogPerformanceRow[] {
  const rows = Array.isArray(raw) ? raw : (raw.searchCatalogPerformance ?? []);
  return rows.map((r) => ({
    asin:         r.asin ?? "",
    productTitle: r.productTitle ?? "",
    searchQuery:  r.searchQuery ?? r.queryString ?? "",
    impressions:  r.impressions ?? 0,
    clicks:       r.clicks ?? 0,
    addToCarts:   r.addToCarts ?? r.cartAdds ?? 0,
    purchases:    r.purchases ?? 0,
  }));
}

export async function fetchCatalogPerformanceReport(
  marketplaceId: string,
  startDate: string,
  endDate: string,
  accountId?: string
): Promise<CatalogPerformanceRow[]> {
  const reportId = await createReport(
    accountId, marketplaceId,
    "GET_BRAND_ANALYTICS_SEARCH_CATALOG_PERFORMANCE_REPORT",
    startDate, endDate
  );
  const raw = await pollAndDownload<Record<string, unknown>>(accountId, reportId);
  return normaliseCatalog(raw as Parameters<typeof normaliseCatalog>[0]);
}
