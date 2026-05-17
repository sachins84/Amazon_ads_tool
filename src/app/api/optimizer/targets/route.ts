import { type NextRequest } from "next/server";
import {
  listAcosTargets, upsertAcosTargets,
  ALL_OPTIMIZER_PROGRAMS, ANY, type AcosTargetRow,
} from "@/lib/db/acos-targets-repo";
import { ALL_INTENTS } from "@/lib/amazon-api/intent";

export const dynamic = "force-dynamic";

/**
 * GET  /api/optimizer/targets?accountId=…
 *   → { targets: AcosTargetRow[], programs, intents, any }
 *     Programs / intents are returned so the UI can render the full grid
 *     even when no rows exist yet.
 *
 * PUT  /api/optimizer/targets?accountId=…
 *   Body: { targets: AcosTargetRow[] }
 *   Replaces the entire matrix for the account. Cells where targetAcos is
 *   blank / 0 are dropped, so the UI can clear by sending empty values.
 */
export async function GET(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get("accountId");
  if (!accountId) return Response.json({ error: "accountId required" }, { status: 400 });

  return Response.json({
    targets: listAcosTargets(accountId),
    programs: ALL_OPTIMIZER_PROGRAMS,
    intents:  ALL_INTENTS,
    any: ANY,
  });
}

export async function PUT(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get("accountId");
  if (!accountId) return Response.json({ error: "accountId required" }, { status: 400 });

  const body = await req.json() as { targets?: AcosTargetRow[] };
  if (!Array.isArray(body.targets)) {
    return Response.json({ error: "body.targets array required" }, { status: 400 });
  }
  const n = upsertAcosTargets(accountId, body.targets);
  return Response.json({ saved: n });
}
