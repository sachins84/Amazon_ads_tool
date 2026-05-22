import { type NextRequest } from "next/server";
import { syncSettlements } from "@/lib/sp-api/settlement-sync";
import { getSyncState } from "@/lib/db/settlement-fees-store";
import { getSpMarketplaceId } from "@/lib/sp-api/client";

export const dynamic = "force-dynamic";

/**
 * GET  /api/sync/settlements                  — current sync state.
 * POST /api/sync/settlements?maxReports=25    — runs the sync (idempotent;
 *   stops at the burst quota and resumes on the next call).
 */
export async function GET() {
  const mp = getSpMarketplaceId() ?? "";
  if (!mp) return Response.json({ error: "No SP-API marketplace configured" }, { status: 200 });
  return Response.json({ marketplaceId: mp, state: getSyncState(mp) });
}

export async function POST(req: NextRequest) {
  const max = parseInt(req.nextUrl.searchParams.get("maxReports") ?? "25", 10);
  const result = await syncSettlements({ maxReports: Math.max(1, Math.min(100, max || 25)) });
  return Response.json(result);
}
