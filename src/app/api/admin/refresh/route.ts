import { type NextRequest } from "next/server";
import { listAccounts } from "@/lib/db/accounts";
import { refreshAccountRecent, type RefreshResult } from "@/lib/amazon-api/refresh-service";
import { listRefreshStates } from "@/lib/db/metrics-store";

/**
 * POST /api/admin/refresh?accountId=…&days=14
 *   Refresh ONE account, trailing N days (default 14 — Amazon's attribution window).
 *
 * POST /api/admin/refresh?all=true&days=14
 *   Refresh every connected account in PARALLEL.
 *
 * GET  /api/admin/refresh
 *   Returns the last-refresh state for every account.
 *
 * Cron recipe (8 AM IST = 02:30 UTC):
 *   30 2 * * * curl -s -X POST 'http://localhost:3000/api/admin/refresh?all=true&days=14' > /dev/null
 *
 * First-time backfill (longer window):
 *   curl -X POST 'http://localhost:3000/api/admin/refresh?accountId=<id>&days=60'
 */
export async function POST(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const accountId = searchParams.get("accountId");
  const all       = searchParams.get("all") === "true";
  const days      = Math.max(1, Math.min(180, parseInt(searchParams.get("days") ?? "14", 10) || 14));

  if (!accountId && !all) {
    return Response.json({ error: "accountId or all=true required" }, { status: 400 });
  }

  if (all) {
    const accounts = listAccounts();
    if (accounts.length === 0) return Response.json({ started: 0, results: [] });
    const results = await Promise.allSettled(
      accounts.map((a) => refreshAccountRecent(a.id, days)),
    );
    const summary = results.map((r, i) => {
      if (r.status === "fulfilled") return r.value;
      return {
        accountId: accounts[i].id,
        brandName: accounts[i].name,
        error: String(r.reason),
      } as Partial<RefreshResult> & { error: string };
    });
    return Response.json({ refreshed: summary.length, results: summary });
  }

  try {
    const result = await refreshAccountRecent(accountId!, days);
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET() {
  return Response.json({ states: listRefreshStates() });
}
