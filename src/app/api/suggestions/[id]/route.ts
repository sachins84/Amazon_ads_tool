import { type NextRequest } from "next/server";
import { listSuggestions, updateSuggestionStatus } from "@/lib/db/rules-repo";
import { applySuggestion } from "@/lib/rules/applier";
import type { SuggestionStatus } from "@/lib/rules/types";

interface Params { params: Promise<{ id: string }> }

/**
 * PATCH /api/suggestions/:id
 *   Body: { status: "APPROVED" | "DISMISSED" | "APPLIED" | "FAILED", apply?: boolean }
 *
 * When apply=true (and status APPROVED|APPLIED), pushes the change to Amazon
 * via the v3 PUT endpoints. The Amazon response is parsed for 207 multi-status
 * errors — on per-item failure we mark the suggestion FAILED with the message
 * in metric_snapshot.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json() as { status?: SuggestionStatus; apply?: boolean };
  if (!body.status) return Response.json({ error: "status required" }, { status: 400 });

  // Look up the suggestion (we need it for apply).
  const sug = listSuggestions({ status: "ANY", limit: 1, ruleId: undefined }).find((s) => s.id === id)
           ?? listSuggestions({ status: "ANY" }).find((s) => s.id === id);

  // If just changing status (no apply), short-circuit.
  if (!body.apply) {
    const ok = updateSuggestionStatus(id, body.status);
    if (!ok) return Response.json({ error: "Suggestion not found" }, { status: 404 });
    return Response.json({ success: true, id, status: body.status });
  }

  if (!sug) return Response.json({ error: "Suggestion not found" }, { status: 404 });

  // Apply to Amazon, then write final status.
  const result = await applySuggestion(sug);
  const finalStatus: SuggestionStatus = result.ok ? "APPLIED" : "FAILED";
  updateSuggestionStatus(id, finalStatus);
  return Response.json({
    success: result.ok,
    id,
    status: finalStatus,
    message: result.message,
  }, { status: result.ok ? 200 : 207 });
}
