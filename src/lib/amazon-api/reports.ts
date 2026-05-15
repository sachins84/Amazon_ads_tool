/**
 * Amazon Ads Reporting API v3.
 * Reports are async: POST to create → poll until COMPLETED → GET download URL.
 */
import { amazonRequest } from "./client";
import { AmazonApiError } from "./token";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReportStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
export type Program = "SP" | "SB" | "SD";

export interface ReportRequest {
  name: string;
  startDate: string;  // YYYY-MM-DD
  endDate: string;    // YYYY-MM-DD
  configuration: {
    adProduct: "SPONSORED_PRODUCTS" | "SPONSORED_BRANDS" | "SPONSORED_DISPLAY";
    groupBy: string[];
    columns: string[];
    reportTypeId: string;
    timeUnit: "DAILY" | "SUMMARY";
    format: "GZIP_JSON";
  };
}

export interface ReportResponse {
  reportId: string;
  status: ReportStatus;
  url?: string;
  fileSize?: number;
}

// ─── Column sets ─────────────────────────────────────────────────────────────

// v3 spTargeting report: `keywordId` is the universal ID across keywords AND
// product targets (despite the name). The text/type fields are `targeting` and
// `keywordType` — there is NO targetId / targetingText / targetingType in v3.
// `date` is required for timeUnit=DAILY which we use so the metrics-store
// can hold per-day rows.
export const SP_TARGETING_COLUMNS = [
  "date",
  "campaignId", "campaignName", "adGroupId", "adGroupName",
  "keywordId", "keyword", "targeting", "matchType", "keywordType",
  "impressions", "clicks", "cost",
  "purchases7d", "sales7d",
];

// Daily-grouped campaign reports — used for both totals AND time series.
export const SP_CAMPAIGN_COLUMNS = [
  "date", "campaignId", "campaignName",
  "impressions", "clicks", "cost",
  "purchases7d", "sales7d", "purchases30d", "sales30d",
];

export const SB_CAMPAIGN_COLUMNS = [
  "date", "campaignId", "campaignName",
  "impressions", "clicks", "cost", "purchases", "sales",
];

export const SD_CAMPAIGN_COLUMNS = [
  "date", "campaignId", "campaignName",
  "impressions", "clicks", "cost", "purchases", "sales",
];

export const SB_ADGROUP_COLUMNS = [
  "date", "campaignId", "adGroupId", "adGroupName",
  "impressions", "clicks", "cost", "purchases", "sales",
];
export const SD_ADGROUP_COLUMNS = [
  "date", "campaignId", "adGroupId", "adGroupName",
  "impressions", "clicks", "cost", "purchases", "sales",
];

// ─── API helpers ─────────────────────────────────────────────────────────────

export async function createReport(
  profileId: string,
  req: ReportRequest,
  accountId?: string,
): Promise<string> {
  try {
    const res = await amazonRequest<{ reportId: string }>("/reporting/reports", {
      profileId, accountId, method: "POST", body: req,
    });
    return res.reportId;
  } catch (e) {
    // Amazon returns 425 when an identical report was submitted recently.
    // The error body contains the existing reportId — reuse it.
    if (e instanceof AmazonApiError && e.status === 425) {
      const m = e.message.match(/duplicate of\s*:?\s*([0-9a-f-]{36})/i);
      if (m) return m[1];
    }
    throw e;
  }
}

export async function getReportStatus(
  profileId: string,
  reportId: string,
  accountId?: string,
): Promise<ReportResponse> {
  return amazonRequest<ReportResponse>(`/reporting/reports/${reportId}`, { profileId, accountId });
}

/**
 * Poll until the report is COMPLETED, then download and parse its JSON.
 * India / EU region can take 10+ min on cold queries; US usually ~30-60s.
 */
export async function waitForReport<T>(
  profileId: string,
  reportId: string,
  accountId?: string,
  opts: { maxWaitMs?: number; pollIntervalMs?: number } = {},
): Promise<T[]> {
  const maxWaitMs = opts.maxWaitMs ?? 20 * 60 * 1000; // 20 min — India queue can be slow
  const pollMs   = opts.pollIntervalMs ?? 8_000;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    const status = await getReportStatus(profileId, reportId, accountId);
    if (status.status === "COMPLETED" && status.url) {
      return downloadReport<T>(status.url);
    }
    if (status.status === "FAILED") {
      throw new Error(`Report ${reportId} failed`);
    }
    await sleep(pollMs);
  }
  throw new Error(`Report ${reportId} timed out after ${Math.round(maxWaitMs / 1000)}s`);
}

async function downloadReport<T>(url: string, attempt = 0): Promise<T[]> {
  // Node's undici fetch has a 5-min body timeout that bites on big India
  // report downloads. Retry once on network/timeout errors before giving up.
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    if (attempt < 2 && /fetch failed|aborted|timeout|ECONNRESET|UND_ERR/i.test(String(e))) {
      await sleep(2000);
      return downloadReport<T>(url, attempt + 1);
    }
    throw e;
  }
  if (!res.ok) throw new Error(`Report download failed: ${res.status}`);

  let buffer: ArrayBuffer;
  try {
    buffer = await res.arrayBuffer();
  } catch (e) {
    if (attempt < 2 && /fetch failed|aborted|timeout|ECONNRESET|UND_ERR/i.test(String(e))) {
      await sleep(2000);
      return downloadReport<T>(url, attempt + 1);
    }
    throw e;
  }

  const { gunzipSync } = await import("zlib");
  let text: string;
  try {
    text = gunzipSync(Buffer.from(buffer)).toString("utf-8");
  } catch {
    // Some Amazon report URLs return uncompressed JSON despite the GZIP_JSON setting.
    text = Buffer.from(buffer).toString("utf-8");
  }

  const trimmed = text.trim();
  if (trimmed.startsWith("[")) return JSON.parse(trimmed) as T[];
  if (trimmed.startsWith("{")) return [JSON.parse(trimmed) as T];
  return trimmed.split("\n").filter(Boolean).map((line) => JSON.parse(line) as T);
}

// ─── Per-program report helpers ──────────────────────────────────────────────

function spCampaignReportBody(start: string, end: string): ReportRequest {
  return {
    name: `SP campaigns ${start}..${end}`,
    startDate: start, endDate: end,
    configuration: {
      adProduct: "SPONSORED_PRODUCTS",
      groupBy: ["campaign"],
      columns: SP_CAMPAIGN_COLUMNS,
      reportTypeId: "spCampaigns",
      timeUnit: "DAILY",
      format: "GZIP_JSON",
    },
  };
}

function sbCampaignReportBody(start: string, end: string): ReportRequest {
  return {
    name: `SB campaigns ${start}..${end}`,
    startDate: start, endDate: end,
    configuration: {
      adProduct: "SPONSORED_BRANDS",
      groupBy: ["campaign"],
      columns: SB_CAMPAIGN_COLUMNS,
      reportTypeId: "sbCampaigns",
      timeUnit: "DAILY",
      format: "GZIP_JSON",
    },
  };
}

function sdCampaignReportBody(start: string, end: string): ReportRequest {
  return {
    name: `SD campaigns ${start}..${end}`,
    startDate: start, endDate: end,
    configuration: {
      adProduct: "SPONSORED_DISPLAY",
      groupBy: ["campaign"],
      columns: SD_CAMPAIGN_COLUMNS,
      reportTypeId: "sdCampaigns",
      timeUnit: "DAILY",
      format: "GZIP_JSON",
    },
  };
}

export async function fetchCampaignReport(
  profileId: string, startDate: string, endDate: string, accountId?: string,
) {
  const reportId = await createReport(profileId, spCampaignReportBody(startDate, endDate), accountId);
  return waitForReport<Record<string, unknown>>(profileId, reportId, accountId);
}

export async function fetchTargetingReport(
  profileId: string, startDate: string, endDate: string, accountId?: string,
) {
  const reportId = await createReport(profileId, {
    name: `Targeting ${startDate}..${endDate}`,
    startDate, endDate,
    configuration: {
      adProduct: "SPONSORED_PRODUCTS",
      groupBy: ["targeting"],
      columns: SP_TARGETING_COLUMNS,
      reportTypeId: "spTargeting",
      timeUnit: "DAILY",
      format: "GZIP_JSON",
    },
  }, accountId);
  return waitForReport<Record<string, unknown>>(profileId, reportId, accountId);
}

// ─── Unified campaign report across SP+SB+SD ─────────────────────────────────

export interface UnifiedCampaignRow {
  program: Program;
  date: string;          // YYYY-MM-DD
  campaignId: string;
  campaignName: string;
  impressions: number;
  clicks: number;
  cost: number;
  orders: number;        // attributed purchases (program-specific window)
  sales: number;         // attributed sales
}

function normalizeRow(program: Program, r: Record<string, unknown>): UnifiedCampaignRow {
  const orders = program === "SP"
    ? Number(r.purchases7d ?? r.purchases ?? 0)
    : Number(r.purchases ?? 0);
  const sales = program === "SP"
    ? Number(r.sales7d ?? r.sales ?? 0)
    : Number(r.sales ?? 0);
  return {
    program,
    date:         String(r.date ?? ""),
    campaignId:   String(r.campaignId ?? ""),
    campaignName: String(r.campaignName ?? ""),
    impressions:  Number(r.impressions ?? 0),
    clicks:       Number(r.clicks ?? 0),
    cost:         Number(r.cost ?? 0),
    orders,
    sales,
  };
}

/**
 * Fetch SP + SB + SD daily campaign reports in parallel and merge into a
 * single unified row set. Individual program failures are logged and
 * return an empty array (so one program's outage doesn't kill the dashboard).
 */
export async function fetchAllProgramReports(
  profileId: string, startDate: string, endDate: string, accountId?: string,
): Promise<{ rows: UnifiedCampaignRow[]; errors: { program: Program; error: string }[] }> {

  async function run(program: Program, body: ReportRequest): Promise<UnifiedCampaignRow[]> {
    const reportId = await createReport(profileId, body, accountId);
    const raw = await waitForReport<Record<string, unknown>>(profileId, reportId, accountId);
    return raw.map((r) => normalizeRow(program, r));
  }

  const results = await Promise.allSettled([
    run("SP", spCampaignReportBody(startDate, endDate)),
    run("SB", sbCampaignReportBody(startDate, endDate)),
    run("SD", sdCampaignReportBody(startDate, endDate)),
  ]);

  const rows: UnifiedCampaignRow[] = [];
  const errors: { program: Program; error: string }[] = [];
  const programs: Program[] = ["SP", "SB", "SD"];

  results.forEach((res, i) => {
    if (res.status === "fulfilled") rows.push(...res.value);
    else errors.push({ program: programs[i], error: String(res.reason) });
  });

  return { rows, errors };
}

// ─── Ad-group level report (SP+SB+SD, daily) ────────────────────────────────

export interface UnifiedAdGroupRow {
  program: Program;
  date: string;
  campaignId: string;
  adGroupId:  string;
  adGroupName: string;
  impressions: number;
  clicks: number;
  cost: number;
  orders: number;
  sales: number;
}

// Amazon's v3 API has no SP ad-group report (spAdvertisedProduct now requires
// groupBy=advertiser, not adGroup). SP ad-group spend is rolled up at read
// time from targeting_metrics_daily — see hierarchy-service.ts.
function sbAdGroupReport(start: string, end: string): ReportRequest {
  return {
    name: `SB adGroups ${start}..${end}`,
    startDate: start, endDate: end,
    configuration: {
      adProduct: "SPONSORED_BRANDS",
      groupBy: ["adGroup"],
      columns: SB_ADGROUP_COLUMNS,
      reportTypeId: "sbAdGroup",
      timeUnit: "DAILY",
      format: "GZIP_JSON",
    },
  };
}

// Same for SD.
function sdAdGroupReport(start: string, end: string): ReportRequest {
  return {
    name: `SD adGroups ${start}..${end}`,
    startDate: start, endDate: end,
    configuration: {
      adProduct: "SPONSORED_DISPLAY",
      groupBy: ["adGroup"],
      columns: SD_ADGROUP_COLUMNS,
      reportTypeId: "sdAdGroup",
      timeUnit: "DAILY",
      format: "GZIP_JSON",
    },
  };
}

function normalizeAdGroupRow(program: Program, r: Record<string, unknown>): UnifiedAdGroupRow {
  const orders = program === "SP"
    ? Number(r.purchases7d ?? r.purchases ?? 0)
    : Number(r.purchases ?? 0);
  const sales = program === "SP"
    ? Number(r.sales7d ?? r.sales ?? 0)
    : Number(r.sales ?? 0);
  return {
    program,
    date:         String(r.date ?? ""),
    campaignId:   String(r.campaignId ?? ""),
    adGroupId:    String(r.adGroupId ?? ""),
    adGroupName:  String(r.adGroupName ?? ""),
    impressions:  Number(r.impressions ?? 0),
    clicks:       Number(r.clicks ?? 0),
    cost:         Number(r.cost ?? 0),
    orders,
    sales,
  };
}

export async function fetchAllAdGroupReports(
  profileId: string, startDate: string, endDate: string, accountId?: string,
): Promise<{ rows: UnifiedAdGroupRow[]; errors: { program: Program; error: string }[] }> {

  async function run(program: Program, body: ReportRequest): Promise<UnifiedAdGroupRow[]> {
    const reportId = await createReport(profileId, body, accountId);
    const raw = await waitForReport<Record<string, unknown>>(profileId, reportId, accountId);
    return raw.map((r) => normalizeAdGroupRow(program, r));
  }

  const results = await Promise.allSettled([
    run("SB", sbAdGroupReport(startDate, endDate)),
    run("SD", sdAdGroupReport(startDate, endDate)),
  ]);

  const rows: UnifiedAdGroupRow[] = [];
  const errors: { program: Program; error: string }[] = [];
  const programs: Program[] = ["SB", "SD"];

  results.forEach((res, i) => {
    if (res.status === "fulfilled") rows.push(...res.value);
    else errors.push({ program: programs[i], error: String(res.reason) });
  });

  return { rows, errors };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
