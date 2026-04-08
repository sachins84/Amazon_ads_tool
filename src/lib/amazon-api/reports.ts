/**
 * Amazon Ads Reporting API v3.
 * Reports are async: POST to create → poll until COMPLETED → GET download URL.
 */
import { amazonRequest } from "./client";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReportStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";

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

// ─── SP Targeting report columns ─────────────────────────────────────────────

export const SP_TARGETING_COLUMNS = [
  "campaignId",
  "campaignName",
  "adGroupId",
  "adGroupName",
  "keywordId",
  "targetId",
  "targetingText",
  "targetingType",
  "matchType",
  "impressions",
  "clicks",
  "cost",
  "purchases1d",
  "purchases7d",
  "purchases14d",
  "purchases30d",
  "sales1d",
  "sales7d",
  "sales14d",
  "sales30d",
  "unitsSoldClicks1d",
  "unitsSoldClicks7d",
];

export const SP_CAMPAIGN_COLUMNS = [
  "campaignId",
  "campaignName",
  "impressions",
  "clicks",
  "cost",
  "purchases7d",
  "sales7d",
  "purchases30d",
  "sales30d",
];

// ─── API helpers ─────────────────────────────────────────────────────────────

export async function createReport(
  profileId: string,
  req: ReportRequest,
  accountId?: string
): Promise<string> {
  const res = await amazonRequest<{ reportId: string }>("/reporting/reports", {
    profileId,
    accountId,
    method: "POST",
    body: req,
  });
  return res.reportId;
}

export async function getReportStatus(
  profileId: string,
  reportId: string,
  accountId?: string
): Promise<ReportResponse> {
  return amazonRequest<ReportResponse>(`/reporting/reports/${reportId}`, { profileId, accountId });
}

/**
 * Poll until the report is COMPLETED, then download and parse its JSON.
 * Max wait ~5 minutes.
 */
export async function waitForReport<T>(
  profileId: string,
  reportId: string,
  accountId?: string
): Promise<T[]> {
  const MAX_POLLS = 30;
  const POLL_INTERVAL = 10_000; // 10s

  for (let i = 0; i < MAX_POLLS; i++) {
    const status = await getReportStatus(profileId, reportId, accountId);

    if (status.status === "COMPLETED" && status.url) {
      return downloadReport<T>(status.url);
    }

    if (status.status === "FAILED") {
      throw new Error(`Report ${reportId} failed`);
    }

    await sleep(POLL_INTERVAL);
  }

  throw new Error(`Report ${reportId} timed out after ${MAX_POLLS * 10}s`);
}

async function downloadReport<T>(url: string): Promise<T[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Report download failed: ${res.status}`);

  // Reports are gzip-compressed JSON
  const buffer = await res.arrayBuffer();
  const { gunzipSync } = await import("zlib");
  const text = gunzipSync(Buffer.from(buffer)).toString("utf-8");

  // Each line is a JSON object (JSONL format)
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

// ─── Convenience: create + wait ───────────────────────────────────────────────

export async function fetchTargetingReport(
  profileId: string,
  startDate: string,
  endDate: string,
  accountId?: string
) {
  const reportId = await createReport(profileId, {
    name: `Targeting Report ${startDate} to ${endDate}`,
    startDate,
    endDate,
    configuration: {
      adProduct: "SPONSORED_PRODUCTS",
      groupBy: ["targeting"],
      columns: SP_TARGETING_COLUMNS,
      reportTypeId: "spTargeting",
      timeUnit: "SUMMARY",
      format: "GZIP_JSON",
    },
  }, accountId);

  return waitForReport<Record<string, unknown>>(profileId, reportId, accountId);
}

export async function fetchCampaignReport(
  profileId: string,
  startDate: string,
  endDate: string,
  accountId?: string
) {
  const reportId = await createReport(profileId, {
    name: `Campaign Report ${startDate} to ${endDate}`,
    startDate,
    endDate,
    configuration: {
      adProduct: "SPONSORED_PRODUCTS",
      groupBy: ["campaign"],
      columns: SP_CAMPAIGN_COLUMNS,
      reportTypeId: "spCampaigns",
      timeUnit: "DAILY",
      format: "GZIP_JSON",
    },
  }, accountId);

  return waitForReport<Record<string, unknown>>(profileId, reportId, accountId);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
