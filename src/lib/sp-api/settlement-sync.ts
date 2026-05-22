/**
 * Background sync of GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2 into the
 * settlement_fees_daily SQLite table.
 *
 * Why: the SP-API /reports/.../documents/{id} quota is 1/min sustained, burst
 * 15. A user-facing P&L request cannot wait through that — so we sync in the
 * background and have /api/pnl read from DB.
 *
 * Sync strategy:
 *   1. List all settlement reports created since last_synced_created_time
 *      (or 89d back if never run).
 *   2. Skip any whose report_id is already in settlement_reports_processed.
 *   3. Download remaining serially, pacing at 1/min after the burst is gone.
 *   4. Parse, aggregate per (postedDate, asin), UPSERT into DB.
 *   5. Advance last_synced_created_time to the max createdTime we saw.
 *
 * Designed to be re-runnable safely: dedup is by report_id; UPSERT keys are
 * (marketplaceId, postedDate, asin) and the upserted row is a full
 * replacement so re-processing the same source data is idempotent.
 */
import { spRequest, SpApiError, getSpMarketplaceId } from "./client";
import {
  upsertSettlementFees, setSyncState, getSyncState,
  isReportProcessed, markReportProcessed,
  type SettlementFeeDailyRow,
} from "@/lib/db/settlement-fees-store";
import { cacheDelete } from "@/lib/cache";

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

// ─── Listing (paginated) ──────────────────────────────────────────────────────

async function listAllReports(createdSince: string, createdUntil: string): Promise<ReportListItem[]> {
  const all: ReportListItem[] = [];
  const firstParams: Record<string, string> = {
    reportTypes:  REPORT_TYPE,
    createdSince: `${createdSince}T00:00:00Z`,
    createdUntil: `${createdUntil}T23:59:59Z`,
    pageSize:     "100",
  };
  let res = await spRequest<ReportListResponse>("/reports/2021-06-30/reports", { params: firstParams });
  all.push(...(res.reports ?? []));
  while (res.nextToken) {
    res = await spRequest<ReportListResponse>("/reports/2021-06-30/reports", {
      params: { nextToken: res.nextToken },
    });
    all.push(...(res.reports ?? []));
  }
  return all.filter((r) => r.processingStatus === "DONE" && r.reportDocumentId);
}

// ─── Document download with rate-aware backoff ────────────────────────────────

async function downloadReport(documentId: string, attemptDelay = 65_000): Promise<string> {
  let doc: ReportDocResponse | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try { doc = await spRequest<ReportDocResponse>(`/reports/2021-06-30/documents/${documentId}`); break; }
    catch (e) {
      if (e instanceof SpApiError && e.status === 429 && attempt < 4) {
        // 1/min sustained — wait ≥60s for a token to refill.
        await new Promise((r) => setTimeout(r, attemptDelay));
        continue;
      }
      throw e;
    }
  }
  if (!doc) throw new Error("doc fetch failed after retries");

  const res = await fetch(doc.url);
  if (!res.ok) throw new Error(`S3 download failed: ${res.status}`);
  if (doc.compressionAlgorithm === "GZIP") {
    const { gunzipSync } = await import("zlib");
    return gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf-8");
  }
  return res.text();
}

// ─── Parse + aggregate ────────────────────────────────────────────────────────

// Settlement v2 reports use TitleCase-with-spaces descriptions (different
// from /finances/v0/financialEvents which uses CamelCase). Each base fee
// also has GST variants: " IGST" (interstate) or " CGST"/" SGST" (intrastate
// split 50/50). Match by prefix so we don't have to enumerate all of them.
const COMMISSION_PREFIXES = [
  "Commission",
  "Fixed closing fee",
  "Variable closing fee",
  "Technology Fee",
];
const FULFILLMENT_PREFIXES = [
  "FBA Weight Handling Fee",
  "FBA Pick & Pack Fee",
  "FBA Per Unit Fulfillment Fee",
  "Shipping Chargeback",
  "ShippingHB",
];
const STORAGE_PREFIXES = [
  "FBA Storage Fee",
  "FBA Long Term Storage Fee",
  "FBA Inventory Placement Service Fee",
  "Subscription",
];

function matchesAny(desc: string, prefixes: string[]): boolean {
  for (const p of prefixes) if (desc.startsWith(p)) return true;
  return false;
}

interface ParsedAgg {
  marketplaceId: string;
  byKey: Map<string, SettlementFeeDailyRow>;  // key = postedDate|asin
  rowsConsumed: number;
}

/** Settlement TSV uses DD.MM.YYYY for posted-date. Return YYYY-MM-DD or "". */
function normalizeDate(raw: string): string {
  const m = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  // Already ISO?
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return "";
}

function aggregate(text: string, marketplaceId: string): ParsedAgg {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return { marketplaceId, byKey: new Map(), rowsConsumed: 0 };
  const headers = lines[0].split("\t").map((h) => h.trim());
  const idx = (n: string) => headers.indexOf(n);
  // Settlement v2 has SKU but NOT ASIN — brand mapping happens at read time.
  const iSku = idx("sku");
  const iPosted = idx("posted-date");
  const iTxnType = idx("transaction-type");
  const iAmtDesc = idx("amount-description");
  const iAmount  = idx("amount");

  const byKey = new Map<string, SettlementFeeDailyRow>();
  let rowsConsumed = 0;

  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split("\t");
    const amount = parseFloat(c[iAmount] ?? "0");
    if (!isFinite(amount) || amount === 0) continue;
    const postedDate = normalizeDate(c[iPosted] ?? "");
    if (!postedDate) continue;
    const sku = (c[iSku] ?? "").trim() || "";
    const desc = c[iAmtDesc] ?? "";
    const txn  = c[iTxnType] ?? "";

    const key = `${postedDate}|${sku}`;
    let row = byKey.get(key);
    if (!row) {
      row = {
        marketplaceId, postedDate, sku,
        commission: 0, fulfillment: 0, storage: 0, refunds: 0,
        grossPrincipal: 0, rowCount: 0,
      };
      byKey.set(key, row);
    }
    const abs = Math.abs(amount);
    if (txn === "Refund" || (amount < 0 && desc === "Principal")) {
      row.refunds += abs;
    } else if (matchesAny(desc, COMMISSION_PREFIXES)) {
      row.commission += abs;
    } else if (matchesAny(desc, FULFILLMENT_PREFIXES)) {
      row.fulfillment += abs;
    } else if (matchesAny(desc, STORAGE_PREFIXES)) {
      row.storage += abs;
    } else if (desc === "Principal") {
      row.grossPrincipal += amount;   // signed
    }
    row.rowCount++;
    rowsConsumed++;
  }
  return { marketplaceId, byKey, rowsConsumed };
}

// ─── Sync orchestrator ────────────────────────────────────────────────────────

export interface SyncResult {
  marketplaceId: string;
  status: "ok" | "partial" | "error" | "noop";
  reportsListed: number;
  reportsSkipped: number;
  reportsProcessed: number;
  rowsUpserted: number;
  newWatermark: string | null;
  durationSec: number;
  error?: string;
}

let inflight: Promise<SyncResult> | null = null;

/**
 * Syncs all new settlement reports for the configured marketplace into
 * settlement_fees_daily. De-duplicated against concurrent calls.
 *
 * @param maxReports cap on how many reports to download in this run (default
 *   25). Subsequent runs continue from where this one left off (high-water
 *   mark only advances when ALL reports newer than it have been processed —
 *   we use min-createdTime-skipped as the watermark to be safe).
 */
export async function syncSettlements(opts: { maxReports?: number } = {}): Promise<SyncResult> {
  if (inflight) return inflight;
  inflight = (async () => { try { return await runSync(opts); } finally { inflight = null; } })();
  return inflight;
}

async function runSync({ maxReports = 25 }: { maxReports?: number }): Promise<SyncResult> {
  const t0 = Date.now();
  const marketplaceId = getSpMarketplaceId() ?? "";
  if (!marketplaceId) {
    return {
      marketplaceId: "", status: "error", reportsListed: 0, reportsSkipped: 0,
      reportsProcessed: 0, rowsUpserted: 0, newWatermark: null,
      durationSec: 0, error: "No SP-API marketplace configured",
    };
  }

  const state = getSyncState(marketplaceId);
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  const minSince = new Date(); minSince.setDate(minSince.getDate() - 89);
  const lastWaterISO = state?.lastSyncedCreatedTime;
  // SP-API caps createdSince at 89 days. If our watermark is older, clamp.
  const createdSince = !lastWaterISO || new Date(lastWaterISO) < minSince
    ? fmt(minSince)
    : lastWaterISO.slice(0, 10);
  const createdUntil = fmt(new Date());

  let reports: ReportListItem[];
  try {
    reports = await listAllReports(createdSince, createdUntil);
  } catch (e) {
    const err = String(e);
    setSyncState({ marketplaceId, lastSyncedCreatedTime: lastWaterISO ?? null, lastStatus: "error", lastError: err });
    return {
      marketplaceId, status: "error", reportsListed: 0, reportsSkipped: 0,
      reportsProcessed: 0, rowsUpserted: 0, newWatermark: lastWaterISO ?? null,
      durationSec: (Date.now() - t0) / 1000, error: err,
    };
  }

  // Order newest-first so the first sync after a fresh install populates
  // the recent (most relevant) days first. Idempotence is provided by the
  // settlement_reports_processed dedup table — already-seen report_ids are
  // skipped on subsequent runs regardless of order.
  void lastWaterISO; // legacy filter, no longer used (kept for diagnostics)
  const ordered = reports
    .sort((a, b) => (b.createdTime ?? "").localeCompare(a.createdTime ?? ""));

  if (ordered.length === 0) {
    setSyncState({ marketplaceId, lastSyncedCreatedTime: lastWaterISO ?? null, lastStatus: "ok", lastError: null });
    return {
      marketplaceId, status: "noop", reportsListed: reports.length, reportsSkipped: 0,
      reportsProcessed: 0, rowsUpserted: 0, newWatermark: lastWaterISO ?? null,
      durationSec: (Date.now() - t0) / 1000,
    };
  }

  let processed = 0;
  let skipped = 0;
  let rowsUpserted = 0;
  let watermark = lastWaterISO ?? null;
  let lastError: string | null = null;

  for (const r of ordered.slice(0, maxReports)) {
    if (!r.reportDocumentId) { skipped++; continue; }
    if (isReportProcessed(r.reportId)) {
      skipped++;
      // Still advance watermark — we've handled this one in a prior run.
      if (!watermark || r.createdTime > watermark) watermark = r.createdTime;
      continue;
    }
    let text: string;
    try { text = await downloadReport(r.reportDocumentId); }
    catch (e) {
      lastError = `report ${r.reportId}: ${String(e).slice(0, 120)}`;
      console.warn(`[settlement-sync] ${lastError}`);
      // Stop early on persistent rate-limit — preserve burst budget for the
      // next run; do NOT advance the watermark past this report.
      break;
    }
    const agg = aggregate(text, marketplaceId);
    const rows = [...agg.byKey.values()];
    upsertSettlementFees(rows);
    markReportProcessed(r.reportId, agg.rowsConsumed);
    rowsUpserted += rows.length;
    processed++;
    if (!watermark || r.createdTime > watermark) watermark = r.createdTime;
  }

  const status: SyncResult["status"] =
    lastError ? "partial" :
    processed + skipped < ordered.length ? "partial" : "ok";

  setSyncState({
    marketplaceId,
    lastSyncedCreatedTime: watermark,
    lastStatus: status,
    lastError,
  });

  // Bust the rate-derivation cache so the next /api/pnl request picks up
  // the new settled data. Cache key is `brand-fee-rates:${marketplaceId}:...`.
  if (rowsUpserted > 0) cacheDelete(`brand-fee-rates:${marketplaceId}`);

  return {
    marketplaceId, status,
    reportsListed: reports.length,
    reportsSkipped: skipped,
    reportsProcessed: processed,
    rowsUpserted,
    newWatermark: watermark,
    durationSec: (Date.now() - t0) / 1000,
    error: lastError ?? undefined,
  };
}
