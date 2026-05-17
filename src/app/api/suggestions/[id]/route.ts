import { type NextRequest } from "next/server";
import { listSuggestions, updateSuggestionStatus } from "@/lib/db/rules-repo";
import { applySuggestion } from "@/lib/rules/applier";
import { getDb } from "@/lib/db";
import type { SuggestionStatus, Suggestion } from "@/lib/rules/types";

interface Params { params: Promise<{ id: string }> }

/**
 * PATCH /api/suggestions/:id
 *   Body: {
 *     status: "APPROVED" | "DISMISSED" | "APPLIED" | "HELD" | "FAILED",
 *     apply?: boolean,             // if true → push to Amazon, then write final status
 *     overrideValue?: number,      // reviewer's edited action value
 *     reviewer?: string,           // who's making the call (display name)
 *     decisionNote?: string,       // free-text note
 *   }
 *
 * When `apply=true` the route uses overrideValue (if present) as the value sent
 * to Amazon, so reviewers can tweak the engine's suggestion before pushing.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json() as {
    status?: SuggestionStatus;
    apply?: boolean;
    overrideValue?: number;
    reviewer?: string;
    decisionNote?: string;
  };
  if (!body.status) return Response.json({ error: "status required" }, { status: 400 });

  const sug = listSuggestions({ status: "ANY" }).find((s) => s.id === id);
  if (!sug) return Response.json({ error: "Suggestion not found" }, { status: 404 });

  // Persist reviewer/note/override even if just changing status.
  setReviewerAndOverride(id, body.overrideValue, body.reviewer, body.decisionNote);

  if (!body.apply) {
    const ok = updateSuggestionStatus(id, body.status);
    if (!ok) return Response.json({ error: "Suggestion not found" }, { status: 404 });
    return Response.json({ success: true, id, status: body.status });
  }

  // Build the suggestion-with-override for applier.
  const toApply: Suggestion = body.overrideValue != null
    ? { ...sug, actionValue: body.overrideValue }
    : sug;

  const result = await applySuggestion(toApply);
  const finalStatus: SuggestionStatus = result.ok ? "APPLIED" : "FAILED";
  updateSuggestionStatus(id, finalStatus);
  return Response.json({
    success: result.ok,
    id,
    status: finalStatus,
    message: result.message,
  }, { status: result.ok ? 200 : 207 });
}

function setReviewerAndOverride(
  id: string,
  overrideValue: number | undefined,
  reviewer: string | undefined,
  decisionNote: string | undefined,
) {
  const fields: string[] = [];
  const args: unknown[] = [];
  if (overrideValue !== undefined) { fields.push("override_value = ?");  args.push(overrideValue); }
  if (reviewer       !== undefined) { fields.push("reviewer = ?");        args.push(reviewer); }
  if (decisionNote   !== undefined) { fields.push("decision_note = ?");   args.push(decisionNote); }
  if (fields.length === 0) return;
  fields.push("updated_at = datetime('now')");
  args.push(id);
  getDb().prepare(`UPDATE suggestions SET ${fields.join(", ")} WHERE id = ?`).run(...args);
}
