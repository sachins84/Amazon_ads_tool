/**
 * Conservative feedback loop: read past APPLIED-suggestion outcomes from
 * `suggestion_outcomes` (window_days=7), score each as success/failure per
 * its bucket, and return a per-bucket multiplier to apply to NEW suggestions'
 * confidence.
 *
 * Conservative because:
 *   - Only adjusts confidence, never changes the bucket decision itself.
 *   - Requires MIN_SAMPLES per bucket; fewer → multiplier 1.0 (no change).
 *   - Multiplier floor of 0.5 so a string of bad outcomes can't zero out
 *     a bucket entirely — reviewers still see the suggestion, just at
 *     reduced confidence.
 *   - Cap at 1.0 — historical performance can dampen the heuristic but
 *     can't boost it above what the heuristic itself decided.
 *
 * The optimizer-runner loads these per-account once per run and multiplies
 * the heuristic confidence by the bucket's multiplier before persisting.
 */
import { getDb } from "@/lib/db";
import type { Bucket } from "./optimizer";

/** Minimum number of APPLIED-suggestion outcomes in a bucket before we
 *  let history influence confidence. Below this, we don't trust the rate. */
const MIN_SAMPLES = 5;

/** Multiplier floor — even a bucket with 100% bad outcomes still gets at
 *  least 0.5× heuristic confidence (so it surfaces in the UI for review). */
const MULT_FLOOR = 0.5;

/** Default analytical window for the feedback loop. 7d is the sweet spot —
 *  1d/3d are too noisy, 14d takes too long to accumulate signal. */
const WINDOW_DAYS = 7;

export interface BucketLearnedStats {
  total: number;
  successes: number;
  rate: number | null;       // null when total < MIN_SAMPLES
  multiplier: number;        // 1.0 when rate is null
}

export type LearnedStatsByBucket = Map<Bucket, BucketLearnedStats>;

/**
 * Aggregate per-bucket success rates for an account. Returns a Map keyed by
 * bucket. Buckets with no APPLIED outcomes are absent from the map and
 * treated as multiplier=1.0 by callers.
 */
export function getLearnedStatsForAccount(accountId: string): LearnedStatsByBucket {
  const rows = getDb().prepare(`
    SELECT s.bucket,
           o.spend_before, o.sales_before, o.orders_before, o.roas_before,
           o.spend_after,  o.sales_after,  o.orders_after,  o.roas_after
    FROM suggestion_outcomes o
    JOIN suggestions s ON s.id = o.suggestion_id
    WHERE s.account_id = ? AND s.status = 'APPLIED'
      AND o.window_days = ?
      AND s.bucket IS NOT NULL
  `).all(accountId, WINDOW_DAYS) as Array<{
    bucket: Bucket;
    spend_before: number; sales_before: number; orders_before: number; roas_before: number | null;
    spend_after:  number; sales_after:  number; orders_after:  number; roas_after:  number | null;
  }>;

  const tally = new Map<Bucket, { total: number; successes: number }>();
  for (const r of rows) {
    if (!isJudgeable(r.bucket, r)) continue;
    const ok = scoreOutcome(r.bucket, r);
    const t = tally.get(r.bucket) ?? { total: 0, successes: 0 };
    t.total += 1;
    if (ok) t.successes += 1;
    tally.set(r.bucket, t);
  }

  const out: LearnedStatsByBucket = new Map();
  for (const [bucket, t] of tally) {
    const rate = t.total >= MIN_SAMPLES ? t.successes / t.total : null;
    const multiplier = rate == null ? 1.0 : Math.max(MULT_FLOOR, Math.min(1.0, rate));
    out.set(bucket, { total: t.total, successes: t.successes, rate, multiplier });
  }
  return out;
}

interface OutcomeRow {
  spend_before: number; sales_before: number; roas_before: number | null;
  spend_after:  number; sales_after:  number; roas_after:  number | null;
}

/** Skip outcomes with no useful baseline. e.g. roas_before=null on a
 *  SCALE_DOWN means the campaign had no sales before — can't judge whether
 *  the cut "improved efficiency". */
function isJudgeable(bucket: Bucket, r: OutcomeRow): boolean {
  switch (bucket) {
    case "PAUSE":
      return r.spend_before > 0;
    case "SCALE_DOWN":
    case "BID_DOWN":
    case "SCALE_UP":
    case "BID_UP":
      return r.spend_before > 0 && r.sales_before > 0;
    case "HOLD":
      return false; // HOLD suggestions don't get inserted, but defensive
  }
}

/** Per-bucket success criterion — keep these simple + conservative. */
function scoreOutcome(bucket: Bucket, r: OutcomeRow): boolean {
  switch (bucket) {
    case "PAUSE": {
      // Pause succeeded if spending stopped AND we didn't accidentally
      // pause a healthy revenue stream (post-pause sales < half of before
      // — accounting for residual attribution that lingers a day or two).
      const stopped = r.spend_after < r.spend_before * 0.1;
      const salesAcceptable = r.sales_after < r.sales_before * 0.5;
      return stopped && salesAcceptable;
    }
    case "SCALE_DOWN":
    case "BID_DOWN": {
      // The cut should hold or improve ROAS. Tiny slack since cuts often
      // reduce volume slightly even when efficiency improves.
      if (r.roas_before == null || r.roas_after == null) return false;
      return r.roas_after >= r.roas_before * 0.95;
    }
    case "SCALE_UP":
    case "BID_UP": {
      // Sales should grow AND ROAS shouldn't tank. Lean-in only counts as
      // success if both conditions hold.
      if (r.roas_before == null || r.roas_after == null) return false;
      const grew      = r.sales_after >= r.sales_before * 1.10;
      const roasHeld  = r.roas_after  >= r.roas_before  * 0.85;
      return grew && roasHeld;
    }
    case "HOLD":
      return false;
  }
}
