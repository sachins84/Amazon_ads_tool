import { type NextRequest } from "next/server";
import { readCampaignMeta } from "@/lib/db/metrics-store";

export const dynamic = "force-dynamic";

/**
 * GET /api/campaigns?accountId=… → { campaigns }
 *
 * Lightweight campaign list for pickers (e.g. the pause scheduler). Returns
 * id / name / program / state from stored campaign_meta. ARCHIVED campaigns
 * are excluded — they can't be re-enabled, so they're not schedulable.
 */
export async function GET(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get("accountId");
  if (!accountId) return Response.json({ error: "accountId required" }, { status: 400 });

  const campaigns = readCampaignMeta(accountId)
    .filter((m) => m.state === "ENABLED" || m.state === "PAUSED")
    .map((m) => ({ campaignId: m.campaignId, name: m.name, program: m.program, state: m.state }))
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

  return Response.json({ campaigns });
}
