/**
 * SP-API Brand Analytics Reports.
 *
 * Three report types:
 * 1. GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT     – SFR + top 3 clicked/purchased ASINs per keyword
 * 2. GET_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT – brand-level keyword market share
 * 3. GET_BRAND_ANALYTICS_SEARCH_CATALOG_PERFORMANCE_REPORT – ASIN × keyword performance
 *
 * IMPORTANT: Brand Analytics reports require exact period boundaries:
 *   - WEEK:  Sunday → Saturday (one complete week)
 *   - MONTH: 1st → last day of month
 * Passing arbitrary date ranges causes FATAL status.
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

// ─── Date helpers for Brand Analytics periods ────────────────────────────────

function fmtDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

/** Get the most recent complete week (Sunday–Saturday) before today */
function lastCompleteWeek(): { start: string; end: string } {
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday
  // Go back to last Saturday
  const lastSat = new Date(now);
  lastSat.setDate(now.getDate() - (day === 0 ? 1 : day + 1));
  // That week's Sunday
  const lastSun = new Date(lastSat);
  lastSun.setDate(lastSat.getDate() - 6);
  return { start: fmtDate(lastSun), end: fmtDate(lastSat) };
}

/** Get the most recent complete month before today */
function lastCompleteMonth(): { start: string; end: string } {
  const now = new Date();
  const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastDayPrevMonth = new Date(firstOfThisMonth);
  lastDayPrevMonth.setDate(0); // last day of previous month
  const firstOfPrevMonth = new Date(lastDayPrevMonth.getFullYear(), lastDayPrevMonth.getMonth(), 1);
  return { start: fmtDate(firstOfPrevMonth), end: fmtDate(lastDayPrevMonth) };
}

/**
 * Pick the best period for a given date-range preset.
 * Brand Analytics only supports WEEK or MONTH — not arbitrary ranges.
 */
function resolvePeriod(datePreset: string): { start: string; end: string; period: "WEEK" | "MONTH" } {
  if (datePreset === "Last Month") {
    return { ...lastCompleteMonth(), period: "MONTH" };
  }
  if (datePreset === "This Month") {
    // Use last complete week within this month
    return { ...lastCompleteWeek(), period: "WEEK" };
  }
  // For Last 7D, 14D, 30D — use last complete week
  return { ...lastCompleteWeek(), period: "WEEK" };
}

// ─── Report creation & polling ───────────────────────────────────────────────

async function createReport(
  accountId: string | undefined,
  marketplaceId: string,
  reportType: string,
  start: string,
  end: string,
  reportOptions: Record<string, string>
): Promise<string> {
  // Retry with backoff on 429 rate limits
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await spReq<CreateReportRes>(accountId, "/reports/2021-06-30/reports", {
        method: "POST",
        body: {
          reportType,
          marketplaceIds: [marketplaceId],
          dataStartTime: `${start}T00:00:00Z`,
          dataEndTime:   `${end}T23:59:59Z`,
          reportOptions,
        },
      });
      return res.reportId;
    } catch (err) {
      const isRateLimit = err instanceof Error && err.message.includes("429") || err instanceof Error && err.message.includes("rate limit");
      if (!isRateLimit || attempt === 3) throw err;
      const waitMs = Math.pow(2, attempt + 1) * 5000; // 10s, 20s, 40s
      console.log(`[brand-analytics] Rate limited creating ${reportType}, retrying in ${waitMs / 1000}s...`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw new Error("Max retries exceeded for report creation");
}

async function pollAndDownload<T>(
  accountId: string | undefined,
  reportId: string
): Promise<T> {
  // Poll intervals: 2s, 4s, 8s, then 15s — detect FATAL quickly
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

    const delay = i < 4 ? Math.min(2000 * Math.pow(2, i), 15_000) : 15_000;
    await new Promise((r) => setTimeout(r, delay));
  }
  throw new Error(`Brand analytics report ${reportId} timed out`);
}

/**
 * Download and parse a report JSON, supporting very large GZIP files.
 * Brand Analytics search terms reports for large marketplaces (India) can exceed
 * Node.js string limits (512MB+). We stream-decompress and extract the first
 * `maxRows` entries from the main array without loading the full file into memory.
 */
async function downloadJson<T>(url: string, compression?: string, maxRows = 1000): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Report download failed: ${res.status}`);

  if (compression === "GZIP") {
    return streamParseGzip<T>(res, maxRows);
  }

  // Non-gzip: try direct parse, fall back to streaming if too large
  const text = await res.text();
  return JSON.parse(text) as T;
}

/**
 * Stream-decompress GZIP and extract JSON in chunks.
 * Collects text in manageable chunks, finds the first large array,
 * and extracts up to `maxRows` entries.
 */
async function streamParseGzip<T>(res: Response, maxRows: number): Promise<T> {
  const { createGunzip } = await import("zlib");
  const { Readable } = await import("stream");

  const raw = Buffer.from(await res.arrayBuffer());

  // Decompress in streaming fashion, collecting text in chunks
  const decoder = new TextDecoder("utf-8");
  let collected = "";
  let done = false;
  const MAX_COLLECTED = 100 * 1024 * 1024; // 100MB text limit — enough for ~1000 rows

  await new Promise<void>((resolve, reject) => {
    const gunzip = createGunzip();
    Readable.from(raw).pipe(gunzip);

    gunzip.on("data", (chunk: Buffer) => {
      if (done) return;
      collected += decoder.decode(chunk, { stream: true });
      // Stop collecting once we have enough data
      if (collected.length > MAX_COLLECTED) {
        done = true;
        gunzip.destroy();
        resolve();
      }
    });
    gunzip.on("end", () => { if (!done) { done = true; resolve(); } });
    gunzip.on("error", (err) => { if (!done) { done = true; reject(err); } });
  });

  // Flush decoder
  collected += decoder.decode();

  console.log("[brand-analytics] Downloaded report:", {
    totalLen: collected.length,
    first500: collected.slice(0, 500),
    wasTruncated: done && collected.length >= MAX_COLLECTED,
  });

  // Try to parse as complete JSON first
  try {
    return JSON.parse(collected) as T;
  } catch {
    // File was truncated (too large) — extract what we can
  }

  // Try JSONL (one JSON object per line)
  const lines = collected.split("\n").filter(Boolean);
  if (lines.length > 1) {
    const rows = [];
    for (const line of lines) {
      if (rows.length >= maxRows) break;
      try { rows.push(JSON.parse(line)); } catch { /* skip */ }
    }
    if (rows.length > 0) return rows as T;
  }

  // Partial JSON — extract array entries
  return extractPartialArray<T>(collected, maxRows);
}

/**
 * Extract rows from a potentially truncated JSON string.
 * Finds the first array `[` and parses individual objects from it.
 */
function extractPartialArray<T>(text: string, maxRows: number): T {
  // Find the data array — look for known Brand Analytics keys
  const dataKeys = [
    "dataByDepartmentAndSearchTerm",
    "dataByAsin",
    "searchQueryPerformanceData",
    "searchCatalogPerformance",
    "searchQueryPerformance",
  ];

  let key = "";
  let arrayStart = -1;

  for (const dk of dataKeys) {
    const idx = text.indexOf(`"${dk}"`);
    if (idx !== -1) {
      // Find the opening '[' after this key
      const bracketIdx = text.indexOf("[", idx + dk.length + 2);
      if (bracketIdx !== -1) {
        key = dk;
        arrayStart = bracketIdx;
        break;
      }
    }
  }

  // Fallback: find the first large array (skip small ones like marketplaceIds)
  if (arrayStart === -1) {
    // Find first '[' followed eventually by '{'
    const re = /\[\s*\{/g;
    let match;
    while ((match = re.exec(text)) !== null) {
      // Skip if it's a small array (like marketplaceIds)
      const before = text.slice(Math.max(0, match.index - 50), match.index);
      if (before.includes("marketplaceIds")) continue;
      arrayStart = match.index;
      // Try to extract key name
      const keyMatch = before.match(/"([^"]+)"\s*:\s*$/);
      if (keyMatch) key = keyMatch[1];
      break;
    }
  }

  if (arrayStart === -1) {
    throw new Error("Could not find data array in report JSON");
  }

  // Extract individual objects by tracking { } depth
  const arrayContent = text.slice(arrayStart + 1); // skip '['
  const rows: unknown[] = [];
  let depth = 0;
  let objStart = -1;

  for (let i = 0; i < arrayContent.length && rows.length < maxRows; i++) {
    const ch = arrayContent[i];
    if (ch === "{") {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && objStart >= 0) {
        try {
          rows.push(JSON.parse(arrayContent.slice(objStart, i + 1)));
        } catch { /* skip malformed / truncated object */ }
        objStart = -1;
      }
    }
  }

  console.log(`[brand-analytics] extractPartialArray: key="${key}", found ${rows.length} rows`);

  // Reconstruct the original shape
  if (key) {
    return { [key]: rows } as T;
  }
  return rows as T;
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
  clickedAsinList?: {
    asin: string;
    clickShare: number;
    conversionShare: number;
  }[];
}

function normaliseSearchTerms(raw: Record<string, unknown>): SearchTermRow[] {
  // SP-API returns: { reportSpecification: {...}, dataByDepartmentAndSearchTerm: [ { departmentName, searchTerm, searchFrequencyRank, clickedAsin, ... } ] }
  const rows = (raw.dataByDepartmentAndSearchTerm ?? (Array.isArray(raw) ? raw : [])) as Record<string, unknown>[];

  // Group by searchTerm (each search term can appear 1-3 times, once per clicked ASIN)
  const termMap = new Map<string, SearchTermRow>();

  for (const r of rows) {
    const term = String(r.searchTerm ?? "");
    const sfr  = Number(r.searchFrequencyRank ?? 0);
    const asin = String(r.clickedAsin ?? "");
    const clickShare = Number(r.clickShare ?? 0);
    const convShare  = Number(r.conversionShare ?? 0);
    const rank = Number(r.clickShareRank ?? r.departmentRank ?? 99);

    if (!termMap.has(term)) {
      termMap.set(term, {
        searchTerm: term,
        searchFrequencyRank: sfr,
        asin1: "", asin1ClickShare: 0, asin1ConversionShare: 0,
        asin2: "", asin2ClickShare: 0, asin2ConversionShare: 0,
        asin3: "", asin3ClickShare: 0, asin3ConversionShare: 0,
      });
    }
    const entry = termMap.get(term)!;

    // Fill slots based on click share rank (1, 2, 3) or next empty slot
    if (rank === 1 || (!entry.asin1 && !entry.asin2)) {
      if (!entry.asin1) {
        entry.asin1 = asin; entry.asin1ClickShare = clickShare; entry.asin1ConversionShare = convShare;
      } else if (!entry.asin2) {
        entry.asin2 = asin; entry.asin2ClickShare = clickShare; entry.asin2ConversionShare = convShare;
      } else if (!entry.asin3) {
        entry.asin3 = asin; entry.asin3ClickShare = clickShare; entry.asin3ConversionShare = convShare;
      }
    } else if (rank === 2) {
      entry.asin2 = asin; entry.asin2ClickShare = clickShare; entry.asin2ConversionShare = convShare;
    } else if (rank === 3) {
      entry.asin3 = asin; entry.asin3ClickShare = clickShare; entry.asin3ConversionShare = convShare;
    } else {
      // Fill next empty slot
      if (!entry.asin1) { entry.asin1 = asin; entry.asin1ClickShare = clickShare; entry.asin1ConversionShare = convShare; }
      else if (!entry.asin2) { entry.asin2 = asin; entry.asin2ClickShare = clickShare; entry.asin2ConversionShare = convShare; }
      else if (!entry.asin3) { entry.asin3 = asin; entry.asin3ClickShare = clickShare; entry.asin3ConversionShare = convShare; }
    }
  }

  return Array.from(termMap.values());
}

export async function fetchSearchTermsReport(
  marketplaceId: string,
  _startDate: string,
  _endDate: string,
  accountId?: string,
  datePreset?: string,
): Promise<SearchTermRow[]> {
  const { start, end, period } = resolvePeriod(datePreset ?? "Last 30D");
  const reportId = await createReport(
    accountId, marketplaceId,
    "GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT",
    start, end,
    { reportPeriod: period }
  );
  const raw = await pollAndDownload<Record<string, unknown>>(accountId, reportId);
  const dataArr = (raw.dataByDepartmentAndSearchTerm ?? []) as unknown[];
  console.log("[brand-analytics] Search Terms: dataByDepartmentAndSearchTerm has", dataArr.length, "rows");
  if (dataArr.length > 0) console.log("[brand-analytics] Search Terms first row:", JSON.stringify(dataArr[0]).slice(0, 500));
  return normaliseSearchTerms(raw);
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

function normaliseSQP(raw: Record<string, unknown>): SQPRow[] {
  // SP-API returns: { reportSpecification: {...}, searchQueryPerformanceData: [...] } or similar
  const dataKey = Object.keys(raw).find((k) => k !== "reportSpecification" && Array.isArray(raw[k]));
  const rows = (dataKey ? raw[dataKey] : (Array.isArray(raw) ? raw : [])) as Record<string, unknown>[];

  return rows.map((r) => {
    // Handle nested data structure (e.g. impressionData.impressionCount)
    const impr = r.impressionData as Record<string, unknown> | undefined;
    const click = r.clickData as Record<string, unknown> | undefined;
    const purchase = r.purchaseData as Record<string, unknown> | undefined;

    return {
      searchQuery:       String(r.queryString ?? r.searchQuery ?? ""),
      totalSearchVolume: Number(r.totalQueryCount ?? r.totalSearchVolume ?? r.searchQueryVolume ?? 0),
      impressions:       Number(impr?.impressionCount ?? r.impressionsTotal ?? r.impressions ?? 0),
      clicks:            Number(click?.clickCount ?? r.clicksTotal ?? r.clicks ?? 0),
      purchases:         Number(purchase?.purchaseCount ?? r.purchasesTotal ?? r.purchases ?? 0),
      impressionShare:   Number(impr?.brandImpressionShare ?? r.impressionShare ?? 0),
      clickShare:        Number(click?.brandClickShare ?? r.clickShare ?? 0),
      purchaseShare:     Number(purchase?.brandPurchaseShare ?? r.purchaseShare ?? 0),
    };
  });
}

export async function fetchSQPReport(
  marketplaceId: string,
  _startDate: string,
  _endDate: string,
  accountId?: string,
  datePreset?: string,
): Promise<SQPRow[]> {
  const { start, end, period } = resolvePeriod(datePreset ?? "Last 30D");
  const reportId = await createReport(
    accountId, marketplaceId,
    "GET_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT",
    start, end,
    { reportPeriod: period }
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

function normaliseCatalog(raw: Record<string, unknown>): CatalogPerformanceRow[] {
  // SP-API returns: { reportSpecification: {...}, dataByAsin: [ { asin, impressionData: {...}, clickData: {...}, cartAddData: {...}, purchaseData: {...} } ] }
  const rows = (raw.dataByAsin ?? raw.searchCatalogPerformance ?? (Array.isArray(raw) ? raw : [])) as Record<string, unknown>[];
  return rows.map((r) => {
    const impr = r.impressionData as Record<string, unknown> | undefined;
    const click = r.clickData as Record<string, unknown> | undefined;
    const cart = r.cartAddData as Record<string, unknown> | undefined;
    const purchase = r.purchaseData as Record<string, unknown> | undefined;
    return {
      asin:         String(r.asin ?? ""),
      productTitle: String(r.productTitle ?? ""),
      searchQuery:  String(r.searchQuery ?? r.queryString ?? ""),
      impressions:  Number(impr?.impressionCount ?? r.impressions ?? 0),
      clicks:       Number(click?.clickCount ?? r.clicks ?? 0),
      addToCarts:   Number(cart?.cartAddCount ?? r.addToCarts ?? r.cartAdds ?? 0),
      purchases:    Number(purchase?.purchaseCount ?? r.purchases ?? 0),
      clickRate:    Number(click?.clickRate ?? 0),
    };
  });
}

export async function fetchCatalogPerformanceReport(
  marketplaceId: string,
  _startDate: string,
  _endDate: string,
  accountId?: string,
  datePreset?: string,
): Promise<CatalogPerformanceRow[]> {
  const { start, end, period } = resolvePeriod(datePreset ?? "Last 30D");
  const reportId = await createReport(
    accountId, marketplaceId,
    "GET_BRAND_ANALYTICS_SEARCH_CATALOG_PERFORMANCE_REPORT",
    start, end,
    { reportPeriod: period }
  );
  const raw = await pollAndDownload<Record<string, unknown>>(accountId, reportId);
  const dataArr = (raw.dataByAsin ?? []) as unknown[];
  console.log("[brand-analytics] Catalog: dataByAsin has", dataArr.length, "rows");
  if (dataArr.length > 0) console.log("[brand-analytics] Catalog first row:", JSON.stringify(dataArr[0]).slice(0, 500));
  return normaliseCatalog(raw);
}
