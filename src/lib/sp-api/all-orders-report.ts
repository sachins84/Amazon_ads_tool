/**
 * SP-API All Orders Report — per-ASIN per-FC orders + sales.
 *
 * Uses GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL (TSV, gzipped).
 * Columns we care about:
 *   purchase-date, asin, item-name (the product title we display),
 *   quantity-purchased, item-price, ship-city, ship-state
 *
 * Other columns Amazon includes but we ignore: order-id, sku, item-status,
 * shipping-price, gift-wrap-price, currency, ship-postal-code, ship-country,
 * promotion-ids, is-business-order, etc.
 *
 * One row per order ITEM (one order can have multiple items / multiple ASINs).
 * The caller aggregates by (date × asin × ship-city × ship-state) so the same
 * ASIN shipped to the same city/state on the same day rolls up to one row.
 */
import { spRequest } from "./client";

interface CreateReportResponse { reportId: string }
interface ReportStatusResponse {
  processingStatus: "IN_QUEUE" | "IN_PROGRESS" | "DONE" | "CANCELLED" | "FATAL";
  reportDocumentId?: string;
}
interface ReportDocResponse {
  reportDocumentId: string;
  url: string;
  compressionAlgorithm?: "GZIP";
}

export interface AllOrdersItemRow {
  purchaseDate: string;        // YYYY-MM-DD (derived from the full ISO timestamp)
  asin: string;
  itemName: string;
  quantity: number;
  itemPrice: number;
  shipCity: string;
  shipState: string;
}

/** Kick off the All Orders report. Returns a reportId you poll with `waitForAllOrdersReport`. */
export async function createAllOrdersReport(
  marketplaceId: string,
  startDate: string,
  endDate: string,
): Promise<string> {
  const res = await spRequest<CreateReportResponse>("/reports/2021-06-30/reports", {
    method: "POST",
    body: {
      reportType:     "GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL",
      marketplaceIds: [marketplaceId],
      dataStartTime:  `${startDate}T00:00:00Z`,
      dataEndTime:    `${endDate}T23:59:59Z`,
    },
  });
  return res.reportId;
}

/** Poll until the report is DONE, then download + parse.
 *
 *  All Orders by order-date is Seller-account-wide (every brand's orders),
 *  so report generation routinely takes 10-20 min for an account with
 *  tens of thousands of orders across a 14-day window. Default poll
 *  envelope: 100 × 15s = 25 min. Sales-traffic uses MAX_POLLS=20 (5 min)
 *  because that report is far smaller. */
export async function waitForAllOrdersReport(reportId: string): Promise<AllOrdersItemRow[]> {
  const MAX_POLLS = 100;
  const POLL_MS   = 15_000;
  for (let i = 0; i < MAX_POLLS; i++) {
    const status = await spRequest<ReportStatusResponse>(`/reports/2021-06-30/reports/${reportId}`);
    if (status.processingStatus === "DONE" && status.reportDocumentId) {
      return downloadAndParse(status.reportDocumentId);
    }
    if (status.processingStatus === "FATAL" || status.processingStatus === "CANCELLED") {
      throw new Error(`SP-API All Orders report ${reportId} failed: ${status.processingStatus}`);
    }
    // Log every 5th poll so refresh-service logs show progress (silent
    // 25-min hangs are the worst kind of debugging experience).
    if (i > 0 && i % 5 === 0) {
      console.log(`[all-orders] report ${reportId} still ${status.processingStatus} after ${(i * POLL_MS) / 1000}s`);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(`SP-API All Orders report ${reportId} timed out after ${(MAX_POLLS * POLL_MS) / 1000}s`);
}

async function downloadAndParse(documentId: string): Promise<AllOrdersItemRow[]> {
  const doc = await spRequest<ReportDocResponse>(`/reports/2021-06-30/documents/${documentId}`);
  const res = await fetch(doc.url);
  if (!res.ok) throw new Error(`SP-API document download failed (${res.status})`);

  let text: string;
  if (doc.compressionAlgorithm === "GZIP") {
    const { gunzipSync } = await import("zlib");
    text = gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf-8");
  } else {
    text = await res.text();
  }
  return parseTsv(text);
}

/**
 * Amazon's flat-file All Orders TSV is tab-separated with a header row.
 * Column casing varies across regions (sometimes "Amazon Order Id", sometimes
 * "amazon-order-id") — normalise by lowercasing and replacing spaces with
 * dashes before lookup.
 */
function parseTsv(text: string): AllOrdersItemRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];

  const norm = (s: string) => s.toLowerCase().replace(/[\s_]+/g, "-").trim();
  const header = lines[0].split("\t").map(norm);
  const idx = (name: string) => header.indexOf(name);

  const cPurchaseDate = idx("purchase-date");
  const cAsin         = idx("asin");
  const cItemName     = idx("product-name") >= 0 ? idx("product-name") : idx("item-name");
  const cQty          = idx("quantity-purchased") >= 0 ? idx("quantity-purchased") : idx("quantity-shipped");
  const cItemPrice    = idx("item-price");
  const cShipCity     = idx("ship-city");
  const cShipState    = idx("ship-state");

  const out: AllOrdersItemRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split("\t");
    const asin = cAsin >= 0 ? (cells[cAsin] ?? "").trim() : "";
    if (!asin) continue;
    const ts = cPurchaseDate >= 0 ? (cells[cPurchaseDate] ?? "") : "";
    const date = ts.slice(0, 10);
    if (!date) continue;

    out.push({
      purchaseDate: date,
      asin,
      itemName:  cItemName  >= 0 ? (cells[cItemName]  ?? "").trim() : "",
      quantity:  cQty       >= 0 ? Number(cells[cQty]) || 0 : 0,
      itemPrice: cItemPrice >= 0 ? Number(cells[cItemPrice]) || 0 : 0,
      shipCity:  cShipCity  >= 0 ? (cells[cShipCity]  ?? "").trim() : "",
      shipState: cShipState >= 0 ? (cells[cShipState] ?? "").trim() : "",
    });
  }
  return out;
}

/** Convenience wrapper: create → wait → parse, in one call. */
export async function fetchAllOrdersReport(
  marketplaceId: string,
  startDate: string,
  endDate: string,
): Promise<AllOrdersItemRow[]> {
  const reportId = await createAllOrdersReport(marketplaceId, startDate, endDate);
  return waitForAllOrdersReport(reportId);
}

/**
 * In-flight de-dup + 10-min memo, same pattern as brand-split-sales.ts.
 * One Seller Central account = one All Orders report; if four brand
 * refreshes fire concurrently they all share the single underlying SP
 * report instead of each kicking off its own (Amazon-side report
 * creation is ~30s-2min and rate-limited at 1/minute for some types).
 */
const inflight = new Map<string, Promise<AllOrdersItemRow[]>>();
const memo: Map<string, { at: number; rows: AllOrdersItemRow[] }> = new Map();
const MEMO_TTL_MS = 10 * 60 * 1000;

export async function fetchAllOrdersReportCached(
  marketplaceId: string,
  startDate: string,
  endDate: string,
): Promise<AllOrdersItemRow[]> {
  const key = `${marketplaceId}|${startDate}|${endDate}`;
  const cached = memo.get(key);
  if (cached && Date.now() - cached.at < MEMO_TTL_MS) return cached.rows;

  const existing = inflight.get(key);
  if (existing) return existing;

  const p = fetchAllOrdersReport(marketplaceId, startDate, endDate)
    .then((rows) => { memo.set(key, { at: Date.now(), rows }); return rows; })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
