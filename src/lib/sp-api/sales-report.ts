/**
 * SP-API Reports API — GET_SALES_AND_TRAFFIC_REPORT
 * More efficient than Orders API for large accounts (one report vs many paginated calls).
 * Returns per-ASIN and per-date traffic + sales data.
 *
 * Docs: https://developer-docs.amazon.com/sp-api/docs/report-type-values-analytics
 */
import { spRequest } from "./client";

type ReportStatus = "IN_QUEUE" | "IN_PROGRESS" | "DONE" | "FATAL" | "CANCELLED";

interface CreateReportResponse  { reportId: string }
interface ReportStatusResponse  { reportId: string; processingStatus: ReportStatus; reportDocumentId?: string }
interface ReportDocResponse     { reportDocumentId: string; url: string; compressionAlgorithm?: string }

export interface SalesTrafficRow {
  date: string;
  orderedProductSales: { amount: number; currencyCode: string };
  totalOrderItems: number;
  unitsOrdered: number;
  browserPageViews: number;
  browserSessions: number;
  unitSessionPercentage: number;
}

// Actual shape returned by the report JSON
interface RawReportRow {
  date: string;
  salesByDate?: {
    orderedProductSales?: { amount: number; currencyCode: string };
    totalOrderItems?: number;
    unitsOrdered?: number;
  };
  trafficByDate?: {
    browserPageViews?: number;
    browserSessions?: number;
    unitSessionPercentage?: number;
  };
}

// ─── Create report ─────────────────────────────────────────────────────────────

export async function createSalesReport(
  marketplaceId: string,
  startDate: string,
  endDate: string
): Promise<string> {
  const res = await spRequest<CreateReportResponse>("/reports/2021-06-30/reports", {
    method: "POST",
    body: {
      reportType:     "GET_SALES_AND_TRAFFIC_REPORT",
      marketplaceIds: [marketplaceId],
      dataStartTime:  `${startDate}T00:00:00Z`,
      dataEndTime:    `${endDate}T23:59:59Z`,
      reportOptions:  { dateGranularity: "DAY", asinGranularity: "PARENT" },
    },
  });
  return res.reportId;
}

// ─── Poll + download ───────────────────────────────────────────────────────────

export async function waitForSalesReport(reportId: string): Promise<SalesTrafficRow[]> {
  const MAX_POLLS = 20;

  for (let i = 0; i < MAX_POLLS; i++) {
    const status = await spRequest<ReportStatusResponse>(`/reports/2021-06-30/reports/${reportId}`);

    if (status.processingStatus === "DONE" && status.reportDocumentId) {
      return downloadSalesReport(status.reportDocumentId);
    }
    if (status.processingStatus === "FATAL" || status.processingStatus === "CANCELLED") {
      throw new Error(`SP-API sales report ${reportId} failed: ${status.processingStatus}`);
    }

    await new Promise((r) => setTimeout(r, 15_000)); // 15s poll interval
  }

  throw new Error(`SP-API sales report ${reportId} timed out`);
}

async function downloadSalesReport(documentId: string): Promise<SalesTrafficRow[]> {
  const doc = await spRequest<ReportDocResponse>(`/reports/2021-06-30/documents/${documentId}`);

  const res = await fetch(doc.url);
  if (!res.ok) throw new Error(`Failed to download SP-API report: ${res.status}`);

  let text: string;
  if (doc.compressionAlgorithm === "GZIP") {
    const { gunzipSync } = await import("zlib");
    const buf = await res.arrayBuffer();
    text = gunzipSync(Buffer.from(buf)).toString("utf-8");
  } else {
    text = await res.text();
  }

  const json = JSON.parse(text) as { salesAndTrafficByDate: RawReportRow[] };
  const rows = json.salesAndTrafficByDate ?? [];

  // Normalise nested salesByDate / trafficByDate into flat SalesTrafficRow
  return rows.map((row) => ({
    date:                  row.date,
    orderedProductSales:   row.salesByDate?.orderedProductSales ?? { amount: 0, currencyCode: "INR" },
    totalOrderItems:       row.salesByDate?.totalOrderItems ?? 0,
    unitsOrdered:          row.salesByDate?.unitsOrdered ?? 0,
    browserPageViews:      row.trafficByDate?.browserPageViews ?? 0,
    browserSessions:       row.trafficByDate?.browserSessions ?? 0,
    unitSessionPercentage: row.trafficByDate?.unitSessionPercentage ?? 0,
  }));
}

// ─── Convenience ──────────────────────────────────────────────────────────────

export async function fetchSalesTrafficReport(
  marketplaceId: string,
  startDate: string,
  endDate: string
): Promise<SalesTrafficRow[]> {
  const reportId = await createSalesReport(marketplaceId, startDate, endDate);
  return waitForSalesReport(reportId);
}
