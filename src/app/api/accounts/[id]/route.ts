import { type NextRequest } from "next/server";
import { getAccount, updateAccount, deleteAccount, toSafe, type AccountInput } from "@/lib/db/accounts";

interface Params { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const account = getAccount(id);
  if (!account) return Response.json({ error: "Account not found" }, { status: 404 });
  return Response.json({ account: toSafe(account) });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { id }   = await params;
  const body     = await req.json() as Partial<AccountInput>;
  const updated  = updateAccount(id, body);
  if (!updated) return Response.json({ error: "Account not found" }, { status: 404 });
  return Response.json({ account: updated });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id }  = await params;
  const deleted = deleteAccount(id);
  if (!deleted) return Response.json({ error: "Account not found" }, { status: 404 });
  return Response.json({ success: true });
}
