import { type NextRequest } from "next/server";
import { listRules, createRule } from "@/lib/db/rules-repo";
import type { Action, AppliesTo, ConditionTree, Program, RuleMode } from "@/lib/rules/types";

export async function GET(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get("accountId") ?? undefined;
  return Response.json({ rules: listRules({ accountId }) });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  try {
    const rule = createRule({
      name:        String(body.name ?? ""),
      accountId:   body.accountId   ?? null,
      objectiveId: body.objectiveId ?? null,
      appliesTo:   body.appliesTo as AppliesTo,
      programs:    body.programs as Program[] | null,
      conditions:  body.conditions as ConditionTree,
      actions:     body.actions    as Action[],
      mode:        (body.mode as RuleMode) ?? "SUGGEST",
      enabled:     body.enabled !== false,
    });
    return Response.json({ rule }, { status: 201 });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
