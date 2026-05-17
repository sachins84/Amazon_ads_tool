/**
 * Outcome capture — for every APPLIED suggestion, snapshot the metrics in
 * the N-day window BEFORE apply_date and the same-length window AFTER, so
 * the optimizer can score its own past decisions and (eventually) feed
 * learned signals back into the heuristic.
 *
 * Called from refreshAccountRecent after the metrics pull lands fresh data.
 * Idempotent: skips windows already captured, and windows where not enough
 * days have elapsed since apply.
 */
import { getDb } from "@/lib/db";
import {
  readCampaignMetrics,
  readAdGroupMetrics,
  readTargetingMetrics,
} from "@/lib/db/metrics-store";

const WINDOWS = [1, 3, 7, 14] as const;
type Window = typeof WINDOWS[number];

interface AppliedSuggestionRow {
  id: string;
  account_id: string;
  target_type: "CAMPAIGN" | "AD_GROUP" | "KEYWORD" | "PRODUCT_TARGET";
  target_id: string;
  applied_at: string;            // ISO datetime when status flipped to APPLIED
}

interface OutcomeKey { suggestion_id: string; window_days: number }

export interface CaptureSummary {
  accountId: string;
  scanned: number;
  inserted: number;
  skippedExisting: number;
  skippedTooSoon: number;
}

export function captureOutcomesForAccount(accountId: string): CaptureSummary {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);

  const applied = db.prepare(`
    SELECT id, account_id, target_type, target_id, applied_at
    FROM suggestions
    WHERE account_id = ? AND status = 'APPLIED' AND applied_at IS NOT NULL
  `).all(accountId) as AppliedSuggestionRow[];

  const existing = new Set(
    (db.prepare(`
      SELECT o.suggestion_id, o.window_days
      FROM suggestion_outcomes o
      JOIN suggestions s ON s.id = o.suggestion_id
      WHERE s.account_id = ?
    `).all(accountId) as OutcomeKey[]).map((r) => `${r.suggestion_id}:${r.window_days}`)
  );

  const insert = db.prepare(`
    INSERT INTO suggestion_outcomes
      (suggestion_id, window_days,
       spend_before, sales_before, orders_before, roas_before,
       spend_after,  sales_after,  orders_after,  roas_after)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  let skippedExisting = 0;
  let skippedTooSoon = 0;

  for (const s of applied) {
    const applyDate = s.applied_at.slice(0, 10);
    for (const w of WINDOWS) {
      const key = `${s.id}:${w}`;
      if (existing.has(key)) { skippedExisting++; continue; }

      // afterEnd = applyDate + (w - 1). Need it <= today.
      const afterEnd = addDays(applyDate, w - 1);
      if (afterEnd > today) { skippedTooSoon++; continue; }

      const beforeStart = addDays(applyDate, -w);
      const beforeEnd   = addDays(applyDate, -1);
      const afterStart  = applyDate;

      const before = aggregateForTarget(accountId, s.target_type, s.target_id, beforeStart, beforeEnd);
      const after  = aggregateForTarget(accountId, s.target_type, s.target_id, afterStart,  afterEnd);

      insert.run(
        s.id, w,
        before.spend, before.sales, before.orders, roasOf(before),
        after.spend,  after.sales,  after.orders,  roasOf(after),
      );
      inserted++;
    }
  }

  return { accountId, scanned: applied.length, inserted, skippedExisting, skippedTooSoon };
}

interface Agg { spend: number; sales: number; orders: number }

function aggregateForTarget(
  accountId: string,
  targetType: AppliedSuggestionRow["target_type"],
  targetId: string,
  start: string,
  end: string,
): Agg {
  if (start > end) return { spend: 0, sales: 0, orders: 0 };

  if (targetType === "CAMPAIGN") {
    return readCampaignMetrics(accountId, start, end)
      .filter((r) => r.campaignId === targetId)
      .reduce(sum, { spend: 0, sales: 0, orders: 0 });
  }
  if (targetType === "AD_GROUP") {
    return readAdGroupMetrics(accountId, start, end)
      .filter((r) => r.adGroupId === targetId)
      .reduce(sum, { spend: 0, sales: 0, orders: 0 });
  }
  // KEYWORD | PRODUCT_TARGET — both live in targeting_metrics_daily keyed by target_id.
  return readTargetingMetrics(accountId, start, end)
    .filter((r) => r.targetId === targetId)
    .reduce(sum, { spend: 0, sales: 0, orders: 0 });
}

function sum(acc: Agg, r: { cost: number; sales: number; orders: number }): Agg {
  return {
    spend:  acc.spend  + (r.cost   || 0),
    sales:  acc.sales  + (r.sales  || 0),
    orders: acc.orders + (r.orders || 0),
  };
}

function roasOf(a: Agg): number | null {
  if (!a.spend || a.spend <= 0) return null;
  return +(a.sales / a.spend).toFixed(4);
}

function addDays(yyyymmdd: string, n: number): string {
  const d = new Date(yyyymmdd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
