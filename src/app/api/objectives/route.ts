import { type NextRequest } from "next/server";
import { listObjectives, createObjective } from "@/lib/db/rules-repo";

export async function GET(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get("accountId") ?? undefined;
  return Response.json({ objectives: listObjectives({ accountId }) });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  try {
    const objective = createObjective({
      name:         String(body.name ?? ""),
      accountId:    body.accountId ?? null,
      scopeFilter:  body.scopeFilter ?? null,
      targetMetric: body.targetMetric,
      comparator:   body.comparator,
      targetValue:  Number(body.targetValue),
      enabled:      body.enabled !== false,
    });
    return Response.json({ objective }, { status: 201 });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
