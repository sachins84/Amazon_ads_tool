import { type NextRequest } from "next/server";
import { addNote, listNotes, type EntityTargetType } from "@/lib/db/notes-repo";

export const dynamic = "force-dynamic";

/**
 * GET  /api/notes?accountId=…&targetType=…&targetId=…  → { notes }
 * POST /api/notes  { accountId, targetType, targetId, body, author? }
 *   Append-only. Returns the new note.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const accountId = sp.get("accountId");
  const targetType = sp.get("targetType") as EntityTargetType | null;
  const targetId = sp.get("targetId");
  if (!accountId || !targetType || !targetId) {
    return Response.json({ error: "accountId + targetType + targetId required" }, { status: 400 });
  }
  return Response.json({ notes: listNotes(accountId, targetType, targetId) });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { accountId?: string; targetType?: EntityTargetType; targetId?: string; body?: string; author?: string };
  if (!body.accountId || !body.targetType || !body.targetId || !body.body) {
    return Response.json({ error: "accountId + targetType + targetId + body required" }, { status: 400 });
  }
  try {
    const note = addNote({
      accountId: body.accountId,
      targetType: body.targetType,
      targetId: body.targetId,
      body: body.body,
      author: body.author ?? null,
    });
    return Response.json({ note });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 400 });
  }
}
