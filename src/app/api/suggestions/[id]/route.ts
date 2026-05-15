import { type NextRequest } from "next/server";
import { updateSuggestionStatus } from "@/lib/db/rules-repo";
import type { SuggestionStatus } from "@/lib/rules/types";

interface Params { params: Promise<{ id: string }> }

/**
 * PATCH /api/suggestions/:id  Body: { status: "APPROVED" | "DISMISSED" | "APPLIED" | "FAILED" }
 *
 * For now this only updates the local row. Actually pushing approvals through
 * to Amazon (mutating campaigns/keywords) is Phase 3 — coming next.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json() as { status?: SuggestionStatus };
  if (!body.status) return Response.json({ error: "status required" }, { status: 400 });
  const ok = updateSuggestionStatus(id, body.status);
  if (!ok) return Response.json({ error: "Suggestion not found" }, { status: 404 });
  return Response.json({ success: true, id, status: body.status });
}
