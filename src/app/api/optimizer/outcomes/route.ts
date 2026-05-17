import { type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { captureOutcomesForAccount } from "@/lib/rules/outcome-capture";

export const dynamic = "force-dynamic";

/**
 * GET /api/optimizer/outcomes?accountId=…&limit=200
 *   Returns every APPLIED suggestion for the account along with whatever
 *   outcome windows have been captured so far. UI groups by window_days.
 *
 * POST /api/optimizer/outcomes?accountId=…
 *   Force a re-scan of the APPLIED set for that account. Idempotent; used
 *   when the user wants outcomes computed without waiting for the next
 *   refresh.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const accountId = searchParams.get("accountId");
  const limit = Math.max(1, Math.min(1000, parseInt(searchParams.get("limit") ?? "200", 10) || 200));
  if (!accountId) return Response.json({ error: "accountId required" }, { status: 400 });

  const db = getDb();
  const suggestions = db.prepare(`
    SELECT id, target_type, target_id, target_name, program, action_type,
           action_value, override_value, current_value, bucket, reason,
           applied_at, reviewer
    FROM suggestions
    WHERE account_id = ? AND status = 'APPLIED' AND applied_at IS NOT NULL
    ORDER BY applied_at DESC
    LIMIT ?
  `).all(accountId, limit) as AppliedRow[];

  if (suggestions.length === 0) {
    return Response.json({ suggestions: [], outcomes: {} });
  }

  const ids = suggestions.map((s) => s.id);
  const placeholders = ids.map(() => "?").join(",");
  const outcomeRows = db.prepare(`
    SELECT suggestion_id, window_days, spend_before, sales_before, orders_before,
           roas_before, spend_after, sales_after, orders_after, roas_after, captured_at
    FROM suggestion_outcomes
    WHERE suggestion_id IN (${placeholders})
  `).all(...ids) as OutcomeRow[];

  const outcomes: Record<string, OutcomeRow[]> = {};
  for (const r of outcomeRows) {
    (outcomes[r.suggestion_id] ??= []).push(r);
  }

  return Response.json({ suggestions, outcomes });
}

export async function POST(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const accountId = searchParams.get("accountId");
  if (!accountId) return Response.json({ error: "accountId required" }, { status: 400 });
  return Response.json(captureOutcomesForAccount(accountId));
}

interface AppliedRow {
  id: string;
  target_type: string;
  target_id: string;
  target_name: string | null;
  program: string | null;
  action_type: string;
  action_value: number | null;
  override_value: number | null;
  current_value: number | null;
  bucket: string | null;
  reason: string;
  applied_at: string;
  reviewer: string | null;
}

interface OutcomeRow {
  suggestion_id: string;
  window_days: number;
  spend_before: number;
  sales_before: number;
  orders_before: number;
  roas_before: number | null;
  spend_after: number;
  sales_after: number;
  orders_after: number;
  roas_after: number | null;
  captured_at: string;
}
