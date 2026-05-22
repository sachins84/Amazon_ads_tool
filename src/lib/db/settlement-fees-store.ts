/**
 * Persistence for settlement-fee aggregates and sync state.
 *
 * Settlement reports are downloaded by a background sync (see
 * settlement-sync.ts) and aggregated per (marketplaceId, postedDate, asin)
 * so the rest of the app can read fee actuals from SQLite without ever
 * touching SP-API in the hot path.
 */
import { getDb } from "./index";

export interface SettlementFeeDailyRow {
  marketplaceId: string;
  postedDate:    string;
  sku:           string;   // empty for whole-settlement adjustments
  commission:    number;
  fulfillment:   number;
  storage:       number;
  refunds:       number;
  grossPrincipal: number;
  rowCount:      number;
}

/** Upsert a batch of per-day-per-SKU fees. Idempotent — re-running with
 *  the same rows produces the same totals (UPSERT replaces). */
export function upsertSettlementFees(rows: SettlementFeeDailyRow[]): void {
  if (!rows.length) return;
  const stmt = getDb().prepare(`
    INSERT INTO settlement_fees_daily
      (marketplace_id, posted_date, sku, commission, fulfillment, storage,
       refunds, gross_principal, row_count, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(marketplace_id, posted_date, sku) DO UPDATE SET
      commission      = excluded.commission,
      fulfillment     = excluded.fulfillment,
      storage         = excluded.storage,
      refunds         = excluded.refunds,
      gross_principal = excluded.gross_principal,
      row_count       = excluded.row_count,
      updated_at      = excluded.updated_at
  `);
  const tx = getDb().transaction((batch: SettlementFeeDailyRow[]) => {
    for (const r of batch) {
      stmt.run(
        r.marketplaceId, r.postedDate, r.sku,
        r.commission, r.fulfillment, r.storage,
        r.refunds, r.grossPrincipal, r.rowCount,
      );
    }
  });
  tx(rows);
}

export function loadSettlementFees(marketplaceId: string, startDate: string, endDate: string): SettlementFeeDailyRow[] {
  return getDb().prepare(`
    SELECT
      marketplace_id  AS marketplaceId,
      posted_date     AS postedDate,
      sku,
      commission, fulfillment, storage, refunds,
      gross_principal AS grossPrincipal,
      row_count       AS rowCount
    FROM settlement_fees_daily
    WHERE marketplace_id = ? AND posted_date BETWEEN ? AND ?
  `).all(marketplaceId, startDate, endDate) as SettlementFeeDailyRow[];
}

/** Returns a sorted list of distinct posted-dates we have data for in the
 *  given marketplace + window. Drives the "settled days" maturity count. */
export function listSettledDates(marketplaceId: string, startDate: string, endDate: string): string[] {
  const rows = getDb().prepare(`
    SELECT DISTINCT posted_date AS postedDate
    FROM settlement_fees_daily
    WHERE marketplace_id = ? AND posted_date BETWEEN ? AND ?
    ORDER BY posted_date
  `).all(marketplaceId, startDate, endDate) as { postedDate: string }[];
  return rows.map((r) => r.postedDate);
}

// ─── Sync state ──────────────────────────────────────────────────────────────

export interface SyncState {
  marketplaceId:          string;
  lastSyncedCreatedTime:  string | null;
  lastRunAt:              string;
  lastStatus:             "ok" | "partial" | "error" | null;
  lastError:              string | null;
}

export function getSyncState(marketplaceId: string): SyncState | null {
  const r = getDb().prepare(`
    SELECT
      marketplace_id           AS marketplaceId,
      last_synced_created_time AS lastSyncedCreatedTime,
      last_run_at              AS lastRunAt,
      last_status              AS lastStatus,
      last_error               AS lastError
    FROM settlement_sync_state WHERE marketplace_id = ?
  `).get(marketplaceId) as SyncState | undefined;
  return r ?? null;
}

export function setSyncState(s: Omit<SyncState, "lastRunAt">): void {
  getDb().prepare(`
    INSERT INTO settlement_sync_state
      (marketplace_id, last_synced_created_time, last_run_at, last_status, last_error)
    VALUES (?, ?, datetime('now'), ?, ?)
    ON CONFLICT(marketplace_id) DO UPDATE SET
      last_synced_created_time = excluded.last_synced_created_time,
      last_run_at              = datetime('now'),
      last_status              = excluded.last_status,
      last_error               = excluded.last_error
  `).run(s.marketplaceId, s.lastSyncedCreatedTime, s.lastStatus, s.lastError);
}

export function markReportProcessed(reportId: string, rowCount: number): void {
  getDb().prepare(`
    INSERT INTO settlement_reports_processed (report_id, processed_at, row_count)
    VALUES (?, datetime('now'), ?)
    ON CONFLICT(report_id) DO NOTHING
  `).run(reportId, rowCount);
}

export function isReportProcessed(reportId: string): boolean {
  const r = getDb()
    .prepare("SELECT 1 FROM settlement_reports_processed WHERE report_id = ?")
    .get(reportId);
  return !!r;
}
