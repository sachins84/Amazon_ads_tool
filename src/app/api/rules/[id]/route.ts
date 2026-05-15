import { type NextRequest } from "next/server";
import { getRule, updateRule, deleteRule } from "@/lib/db/rules-repo";

interface Params { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const rule = getRule(id);
  if (!rule) return Response.json({ error: "Rule not found" }, { status: 404 });
  return Response.json({ rule });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json();
  const rule = updateRule(id, body);
  if (!rule) return Response.json({ error: "Rule not found" }, { status: 404 });
  return Response.json({ rule });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const ok = deleteRule(id);
  if (!ok) return Response.json({ error: "Rule not found" }, { status: 404 });
  return Response.json({ success: true });
}
