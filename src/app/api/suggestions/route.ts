import { type NextRequest } from "next/server";
import { listSuggestions } from "@/lib/db/rules-repo";
import { runRulesForAccount } from "@/lib/rules/runner";
import type { SuggestionStatus } from "@/lib/rules/types";

/**
 * GET /api/suggestions?accountId=…&status=PENDING|APPROVED|DISMISSED|APPLIED|FAILED|ANY
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const accountId = searchParams.get("accountId") ?? undefined;
  const statusParam = (searchParams.get("status") ?? "PENDING").toUpperCase() as SuggestionStatus | "ANY";

  return Response.json({
    suggestions: listSuggestions({ accountId, status: statusParam }),
  });
}

/**
 * POST /api/suggestions/run?accountId=…&dateRange=…
 * Runs every enabled rule for the account, evaluates against fresh data,
 * inserts PENDING suggestions, returns a summary.
 *
 * (Triggered manually by the user; can be wired to cron next.)
 */
export async function POST(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const accountId  = searchParams.get("accountId");
  const dateRange  = searchParams.get("dateRange") ?? "Last 7D";
  if (!accountId) return Response.json({ error: "accountId required" }, { status: 400 });

  try {
    const result = await runRulesForAccount(accountId, dateRange);
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
