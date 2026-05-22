/**
 * SP-API Settlement Reports — GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2.
 *
 * Why this over /finances/v0/financialEvents:
 *   - One CSV download per settlement cycle (typically 7-14 days)
 *   - No per-event pagination; no 0.5 req/sec rate limit
 *   - Each fee row includes ASIN directly — we don't need SKU→brand lookup
 *   - Coverage is authoritative (this is what Amazon actually pays out on)
 *
 * Limitation: Amazon emits settlement reports per disbursement cycle. Events
 * from the last few days may not yet have settled. For very-recent windows
 * (e.g. "Yesterday"), the data here can be incomplete — caller should fall
 * back to /finances/v0/financialEvents or flag it as partial.
 *
 * Docs: https://developer-docs.amazon.com/sp-api/docs/report-type-values-finance
 */
import { spRequest } from "./client";
import { withCache } from "@/lib/cache";

const REPORT_TYPE = "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2";

interface ReportListItem {
  reportId: string;
  reportType: string;
  dataStartTime?: string;
  dataEndTime?: string;
  createdTime: string;
  processingStatus: string;
  reportDocumentId?: string;
}
interface ReportListResponse { reports: ReportListItem[]; nextToken?: string }
interface ReportDocResponse  { reportDocumentId: string; url: string; compressionAlgorithm?: string }

export interface SettlementRow {
  asin:             string;
  sku:              string;
  orderId:          string;
  postedDate:       string;   // YYYY-MM-DD
  transactionType:  string;   // "Order", "Refund", "Adjustment", ...
  amountType:       string;   // "ItemFees", "ItemPrice", "Adjustment", ...
  amountDescription: string;  // "Commission", "FBAPerUnitFulfillmentFee", "Principal", "Tax", ...
  amount:           number;   // signed — negative = seller pays
  quantity:         number;
}

// ─── List + download ──────────────────────────────────────────────────────────

/** Lists all settlement reports created within [createdSince, createdUntil]. */
async function listSettlementReports(createdSince: string, createdUntil: string): Promise<ReportListItem[]> {
  const all: ReportListItem[] = [];
  let nextToken: string | undefined;
  do {
    const params: Record<string, string> = {
      reportTypes:  REPORT_TYPE,
      createdSince: `${createdSince}T00:00:00Z`,
      createdUntil: `${createdUntil}T23:59:59Z`,
      pageSize:     "100",
    };
    if (nextToken) params.nextToken = nextToken;
    const res = await spRequest<ReportListResponse>("/reports/2021-06-30/reports", { params });
    all.push(...(res.reports ?? []));
    nextToken = res.nextToken;
  } while (nextToken);
  return all.filter((r) => r.processingStatus === "DONE" && r.reportDocumentId);
}

async function downloadSettlementReport(documentId: string): Promise<SettlementRow[]> {
  const doc = await spRequest<ReportDocResponse>(`/reports/2021-06-30/documents/${documentId}`);
  const res = await fetch(doc.url);
  if (!res.ok) throw new Error(`Settlement report download failed: ${res.status}`);

  let text: string;
  if (doc.compressionAlgorithm === "GZIP") {
    const { gunzipSync } = await import("zlib");
    text = gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf-8");
  } else {
    text = await res.text();
  }
  return parseSettlementTsv(text);
}

/** Parses Amazon's tab-separated settlement v2 file. Column order is fixed
 *  but we go by header name to survive minor schema additions. */
function parseSettlementTsv(text: string): SettlementRow[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split("\t").map((h) => h.trim());
  const idx = (name: string) => headers.indexOf(name);
  const iAsin           = idx("asin");
  const iSku            = idx("sku");
  const iOrder          = idx("order-id");
  const iPosted         = idx("posted-date");
  const iTxnType        = idx("transaction-type");
  const iAmtType        = idx("amount-type");
  const iAmtDesc        = idx("amount-description");
  const iAmount         = idx("amount");
  const iQty            = idx("quantity-purchased");

  const out: SettlementRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split("\t");
    const amount = parseFloat(c[iAmount] ?? "0");
    if (!isFinite(amount) || amount === 0) continue;
    out.push({
      asin:              (c[iAsin] ?? "").trim(),
      sku:               (c[iSku] ?? "").trim(),
      orderId:           (c[iOrder] ?? "").trim(),
      postedDate:        (c[iPosted] ?? "").slice(0, 10),
      transactionType:   (c[iTxnType] ?? "").trim(),
      amountType:        (c[iAmtType] ?? "").trim(),
      amountDescription: (c[iAmtDesc] ?? "").trim(),
      amount,
      quantity:          parseInt(c[iQty] ?? "0", 10) || 0,
    });
  }
  return out;
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

export interface FeeAggByAsin {
  asin: string;
  commission:  number;   // |sum| Commission + closing + tech fees
  fulfillment: number;   // |sum| FBA pick/pack/ship
  storage:     number;   // |sum| FBA storage
  refunds:     number;   // |sum| of negative principal/adjustment for refunds
  // for diagnostics
  grossPrincipal: number;
  rowCount: number;
}

const COMMISSION_DESCS = new Set([
  "Commission", "FixedClosingFee", "VariableClosingFee", "TechnologyFee",
  "RefundCommission",
]);
const FULFILLMENT_DESCS = new Set([
  "FBAPerUnitFulfillmentFee", "FBAWeightBasedFee", "FBAPickAndPackFee",
  "ShippingChargeback", "ShippingHB", "GiftwrapChargeback",
]);
const STORAGE_DESCS = new Set([
  "FBAStorageFee", "FBALongTermStorageFee",
  "FBAInventoryPlacementServiceFee", "Subscription",
]);

export interface SettlementFeeAggregates {
  byAsin:  Map<string, FeeAggByAsin>;
  totals:  { commission: number; fulfillment: number; storage: number; refunds: number; grossPrincipal: number; rowsSeen: number };
  reports: { reportId: string; dataStartTime?: string; dataEndTime?: string; rowCount: number }[];
  settledDates: string[];    // YYYY-MM-DD list of every posted-date we saw rows for
  windowStart: string;
  windowEnd:   string;
}

/** Fetch all settlement reports overlapping the window and aggregate per-ASIN
 *  fee totals. Rows are filtered by posted-date within the requested range —
 *  reports themselves may span outside it. */
export async function fetchSettlementFees(startDate: string, endDate: string): Promise<SettlementFeeAggregates> {
  // Look back further than the window — settlement cycles can be 14d+, and
  // a report created 'last week' may contain rows posted 'two weeks ago'.
  const lookbackStart = new Date(startDate); lookbackStart.setDate(lookbackStart.getDate() - 30);
  const lookbackEnd   = new Date(endDate);   lookbackEnd.setDate(lookbackEnd.getDate() + 7);
  const createdSince = lookbackStart.toISOString().split("T")[0];
  const createdUntil = lookbackEnd.toISOString().split("T")[0];

  const reports = await listSettlementReports(createdSince, createdUntil);
  const byAsin = new Map<string, FeeAggByAsin>();
  const totals = { commission: 0, fulfillment: 0, storage: 0, refunds: 0, grossPrincipal: 0, rowsSeen: 0 };
  const reportDiag: SettlementFeeAggregates["reports"] = [];
  const settledDateSet = new Set<string>();

  for (const r of reports) {
    if (!r.reportDocumentId) continue;
    let rows: SettlementRow[];
    try {
      rows = await downloadSettlementReport(r.reportDocumentId);
    } catch (e) {
      console.warn(`[settlement] failed to download report ${r.reportId}: ${String(e).slice(0, 120)}`);
      continue;
    }
    let usedFromThis = 0;
    for (const row of rows) {
      // Filter to requested window by posted-date.
      if (!row.postedDate || row.postedDate < startDate || row.postedDate > endDate) continue;
      settledDateSet.add(row.postedDate);
      // Many rows have no asin (eg whole-settlement adjustments). Skip — those
      // can't be brand-attributed. Their fees roll up into "(unknown)" via the
      // explicit empty-string ASIN key below if you want to surface them.
      const asinKey = row.asin || "(unknown)";
      const bucket = byAsin.get(asinKey) ?? newAsinRow(asinKey);
      const desc = row.amountDescription;
      const amt = Math.abs(row.amount);

      if (row.transactionType === "Refund" || row.amount < 0 && desc === "Principal") {
        bucket.refunds += amt; totals.refunds += amt;
      } else if (COMMISSION_DESCS.has(desc)) {
        bucket.commission += amt; totals.commission += amt;
      } else if (FULFILLMENT_DESCS.has(desc)) {
        bucket.fulfillment += amt; totals.fulfillment += amt;
      } else if (STORAGE_DESCS.has(desc)) {
        bucket.storage += amt; totals.storage += amt;
      } else if (desc === "Principal") {
        bucket.grossPrincipal += row.amount;     // signed — could be sale or refund
        totals.grossPrincipal += row.amount;
      }
      bucket.rowCount++;
      byAsin.set(asinKey, bucket);
      usedFromThis++;
      totals.rowsSeen++;
    }
    reportDiag.push({
      reportId: r.reportId, dataStartTime: r.dataStartTime, dataEndTime: r.dataEndTime,
      rowCount: usedFromThis,
    });
  }
  return {
    byAsin, totals, reports: reportDiag,
    settledDates: [...settledDateSet].sort(),
    windowStart: startDate, windowEnd: endDate,
  };
}

function newAsinRow(asin: string): FeeAggByAsin {
  return { asin, commission: 0, fulfillment: 0, storage: 0, refunds: 0, grossPrincipal: 0, rowCount: 0 };
}

// ─── Cached + de-duped wrapper ────────────────────────────────────────────────

const inflight = new Map<string, Promise<SettlementFeeAggregates>>();

/** 7-day cache. Settlement reports never change once posted, and Amazon
 *  emits new ones on its own ~14-day cycle — refreshing weekly is plenty. */
const SETTLEMENT_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
export async function getSettlementFees(startDate: string, endDate: string): Promise<SettlementFeeAggregates> {
  const key = `settlement-fees:${startDate}:${endDate}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = withCache(key, () => fetchSettlementFees(startDate, endDate), SETTLEMENT_CACHE_MS)
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
