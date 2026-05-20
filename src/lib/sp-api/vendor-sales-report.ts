/**
 * SP-API Reports — GET_VENDOR_SALES_REPORT.
 *
 * Used when an account is configured as salesSource=vendor + vendorCode set.
 * The Indian Mosaic SP-API auth sees multiple vendor codes (one per brand);
 * we scope the report to a single vendor code via reportOptions.
 *
 * Docs: https://developer-docs.amazon.com/sp-api/docs/report-type-values-analytics#vendor-retail-analytics-reports
 */
import { spRequest } from "./client";

type ReportStatus = "IN_QUEUE" | "IN_PROGRESS" | "DONE" | "FATAL" | "CANCELLED";
interface CreateReportResponse  { reportId: string }
interface ReportStatusResponse  { reportId: string; processingStatus: ReportStatus; reportDocumentId?: string }
interface ReportDocResponse     { reportDocumentId: string; url: string; compressionAlgorithm?: string }

/** Shape of the per-ASIN per-day rows in the report's salesByAsin block.
 *  Amount values arrive as numbers (string in some marketplaces — we parse). */
interface RawAsinRow {
  startDate: string;
  endDate?: string;
  asin?: string;
  shippedRevenue?: { amount: number | string; currencyCode: string };
  shippedCogs?:    { amount: number | string; currencyCode: string };
  shippedUnits?: number;
  customerReturns?: number;
  ordersPlaced?: number;
}

interface RawVendorReport {
  reportSpecification?: unknown;
  salesByAsin?: RawAsinRow[];
}

export interface VendorDailyRow {
  date:          string;     // YYYY-MM-DD
  totalRevenue:  number;     // shippedRevenue summed across ASINs for the day
  totalUnits:    number;     // shippedUnits
  totalOrders:   number;     // ordersPlaced
  returns:       number;     // customerReturns
}

// ─── Create + poll + download ──────────────────────────────────────────────

export async function createVendorSalesReport(
  marketplaceId: string,
  startDate: string,
  endDate: string,
  vendorCode: string,
): Promise<string> {
  const res = await spRequest<CreateReportResponse>("/reports/2021-06-30/reports", {
    method: "POST",
    body: {
      reportType:     "GET_VENDOR_SALES_REPORT",
      marketplaceIds: [marketplaceId],
      dataStartTime:  `${startDate}T00:00:00Z`,
      dataEndTime:    `${endDate}T23:59:59Z`,
      reportOptions:  {
        reportPeriod:    "DAY",
        distributorView: "MANUFACTURING",
        sellingProgram:  "RETAIL",
        vendorCode,
      },
    },
  });
  return res.reportId;
}

export async function waitForVendorSalesReport(reportId: string): Promise<RawAsinRow[]> {
  const MAX_POLLS = 30;
  for (let i = 0; i < MAX_POLLS; i++) {
    const status = await spRequest<ReportStatusResponse>(`/reports/2021-06-30/reports/${reportId}`);
    if (status.processingStatus === "DONE" && status.reportDocumentId) {
      return downloadVendorSalesReport(status.reportDocumentId);
    }
    if (status.processingStatus === "FATAL" || status.processingStatus === "CANCELLED") {
      throw new Error(`SP-API vendor sales report ${reportId} failed: ${status.processingStatus}`);
    }
    await new Promise((r) => setTimeout(r, 15_000));
  }
  throw new Error(`SP-API vendor sales report ${reportId} timed out`);
}

async function downloadVendorSalesReport(documentId: string): Promise<RawAsinRow[]> {
  const doc = await spRequest<ReportDocResponse>(`/reports/2021-06-30/documents/${documentId}`);
  const res = await fetch(doc.url);
  if (!res.ok) throw new Error(`Failed to download vendor sales report: ${res.status}`);

  let text: string;
  if (doc.compressionAlgorithm === "GZIP") {
    const { gunzipSync } = await import("zlib");
    const buf = await res.arrayBuffer();
    text = gunzipSync(Buffer.from(buf)).toString("utf-8");
  } else {
    text = await res.text();
  }

  const json = JSON.parse(text) as RawVendorReport;
  return json.salesByAsin ?? [];
}

// ─── Aggregate into daily totals ───────────────────────────────────────────

export async function fetchVendorSalesReport(
  marketplaceId: string,
  startDate: string,
  endDate: string,
  vendorCode: string,
): Promise<VendorDailyRow[]> {
  const reportId = await createVendorSalesReport(marketplaceId, startDate, endDate, vendorCode);
  const rows = await waitForVendorSalesReport(reportId);

  // The report returns per-ASIN per-day rows; roll up to daily totals.
  const byDate = new Map<string, VendorDailyRow>();
  for (const r of rows) {
    const date = (r.startDate || "").slice(0, 10);
    if (!date) continue;
    const cur = byDate.get(date) ?? { date, totalRevenue: 0, totalUnits: 0, totalOrders: 0, returns: 0 };
    cur.totalRevenue += parseFloat(String(r.shippedRevenue?.amount ?? 0)) || 0;
    cur.totalUnits   += r.shippedUnits   ?? 0;
    cur.totalOrders  += r.ordersPlaced   ?? 0;
    cur.returns      += r.customerReturns ?? 0;
    byDate.set(date, cur);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
