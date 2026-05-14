import { type NextRequest } from "next/server";
import { listAccounts } from "@/lib/db/accounts";

/**
 * POST /api/admin/prewarm?dateRange=…&accountId=…
 *
 * Triggers the per-account overview pull so its result lands in cache.
 * - Without accountId: warms every connected account in parallel.
 * - Returns immediately with a 'started' status; the actual work runs in the
 *   background (no need to wait, since the user just wants the cache hot).
 *
 * Recommended cron entry (cron daily at 6am IST):
 *   0 0 * * *  curl -s -X POST http://localhost:3000/api/admin/prewarm?dateRange=Yesterday > /dev/null
 *   30 0 * * * curl -s -X POST http://localhost:3000/api/admin/prewarm?dateRange=Last%207D > /dev/null
 */
export async function POST(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const dateRange = searchParams.get("dateRange") ?? "Last 7D";
  const onlyAccountId = searchParams.get("accountId");

  const allAccounts = listAccounts();
  const targets = onlyAccountId
    ? allAccounts.filter((a) => a.id === onlyAccountId)
    : allAccounts;

  if (targets.length === 0) {
    return Response.json({ started: 0, message: "no accounts to warm" });
  }

  const origin = req.nextUrl.origin;

  // Fire in the background; do NOT await — caller gets immediate response.
  for (const a of targets) {
    const url = `${origin}/api/overview?accountId=${a.id}&dateRange=${encodeURIComponent(dateRange)}`;
    // Best-effort: swallow errors so one failure doesn't stop the batch.
    void fetch(url, { cache: "no-store" }).catch((err) => {
      console.error(`[prewarm] ${a.name} failed:`, String(err));
    });
  }

  return Response.json({
    started: targets.length,
    accounts: targets.map((a) => ({ id: a.id, name: a.name, marketplace: a.adsMarketplace })),
    dateRange,
    message: "prewarm started in background; check /api/overview cache TTL (1h) for completion",
  });
}

// Allow GET for convenience (e.g. browser-triggered warm).
export const GET = POST;
