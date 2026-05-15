import { type NextRequest } from "next/server";
import { updateObjective, deleteObjective } from "@/lib/db/rules-repo";

interface Params { params: Promise<{ id: string }> }

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json();
  const updated = updateObjective(id, body);
  if (!updated) return Response.json({ error: "Objective not found" }, { status: 404 });
  return Response.json({ objective: updated });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const ok = deleteObjective(id);
  if (!ok) return Response.json({ error: "Objective not found" }, { status: 404 });
  return Response.json({ success: true });
}
