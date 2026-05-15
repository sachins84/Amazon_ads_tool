import { type NextRequest } from "next/server";
import { getLastActionsByTarget } from "@/lib/db/rules-repo";

/**
 * GET /api/suggestions/recent?accountId=…
 *
 * Returns a map of target_id → most recent non-PENDING suggestion.
 * Used by Targeting 360's "Last Action" column.
 */
export async function GET(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get("accountId");
  if (!accountId) return Response.json({ error: "accountId required" }, { status: 400 });
  return Response.json({ actions: getLastActionsByTarget(accountId) });
}
