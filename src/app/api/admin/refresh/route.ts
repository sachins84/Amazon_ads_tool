import { type NextRequest } from "next/server";
import { listAccounts } from "@/lib/db/accounts";
import { refreshAccountRecent } from "@/lib/amazon-api/refresh-service";
import { listRefreshStates } from "@/lib/db/metrics-store";

/**
 * POST /api/admin/refresh?accountId=…&days=14
 *   Refresh ONE account, trailing N days (default 14 — Amazon's attribution window).
 *
 * POST /api/admin/refresh?all=true&days=14
 *   Refresh every connected account in parallel.
 *
 * POST /api/admin/refresh?…&sync=true
 *   Wait for completion (blocks for 5–15 min on India accounts). Default is
 *   async fire-and-forget: returns 202 immediately, work continues in the
 *   background. Use sync=true only when the caller can wait (cron via a
 *   long-timeout curl, e.g.).
 *
 * GET  /api/admin/refresh
 *   Returns the last-refresh state for every account.
 *
 * Cron recipe (8 AM IST = 02:30 UTC):
 *   30 2 * * * curl -s --max-time 1800 -X POST 'http://localhost:3000/api/admin/refresh?all=true&days=14&sync=true' > /dev/null
 */
export async function POST(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const accountId = searchParams.get("accountId");
  const all       = searchParams.get("all") === "true";
  const sync      = searchParams.get("sync") === "true";
  const days      = Math.max(1, Math.min(180, parseInt(searchParams.get("days") ?? "14", 10) || 14));

  if (!accountId && !all) {
    return Response.json({ error: "accountId or all=true required" }, { status: 400 });
  }

  const targets = all
    ? listAccounts().map((a) => a.id)
    : [accountId!];

  if (targets.length === 0) {
    return Response.json({ started: 0, accounts: [] });
  }

  // ── ASYNC PATH (default): kick off + return immediately ────────────────
  // Returns 202 in <50ms so the browser/proxy never hits its timeout.
  // The refresh keeps running on the server; progress can be polled via
  // GET /api/admin/refresh and the Master Overview reloads pick up cached data
  // as soon as each account's pull lands.
  if (!sync) {
    for (const id of targets) {
      // Swallow per-account errors so one failure doesn't kill the batch.
      void refreshAccountRecent(id, days).catch((err) => {
        console.error(`[refresh] ${id} failed:`, String(err));
      });
    }
    return Response.json(
      {
        started: targets.length,
        accounts: targets,
        days,
        message: "Refresh kicked off in the background. Poll GET /api/admin/refresh to track progress.",
      },
      { status: 202 },
    );
  }

  // ── SYNC PATH: cron / scripts that can wait the full run ───────────────
  if (all) {
    const accounts = listAccounts();
    const results = await Promise.allSettled(accounts.map((a) => refreshAccountRecent(a.id, days)));
    return Response.json({
      refreshed: results.length,
      results: results.map((r, i) =>
        r.status === "fulfilled" ? r.value
        : { accountId: accounts[i].id, brandName: accounts[i].name, error: String(r.reason) }
      ),
    });
  }
  try {
    return Response.json(await refreshAccountRecent(accountId!, days));
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET() {
  return Response.json({ states: listRefreshStates() });
}
