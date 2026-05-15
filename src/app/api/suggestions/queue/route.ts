import { type NextRequest } from "next/server";
import { listRules, createRule, createSuggestions } from "@/lib/db/rules-repo";
import type { Action, AppliesTo, Program, Rule } from "@/lib/rules/types";

/**
 * POST /api/suggestions/queue
 *
 * Creates ONE PENDING suggestion from a user-triggered inline action
 * (Pause / Enable / SetBid / SetBudget). All such manual actions get
 * attached to a single global "Manual edits" rule we lazily create.
 *
 * Body:
 *   {
 *     accountId: string,
 *     targetType: 'CAMPAIGN' | 'AD_GROUP' | 'KEYWORD' | 'PRODUCT_TARGET',
 *     targetId: string,
 *     targetName?: string,
 *     program?: 'SP' | 'SB' | 'SD',
 *     actionType: 'PAUSE' | 'ENABLE' | 'SET_BID' | 'SET_BUDGET',
 *     actionValue?: number,
 *     currentValue?: number,
 *     reason?: string,
 *   }
 */
export async function POST(req: NextRequest) {
  const body = await req.json() as {
    accountId: string;
    targetType: AppliesTo;
    targetId: string;
    targetName?: string;
    program?: Program;
    actionType: Action["type"];
    actionValue?: number;
    currentValue?: number;
    reason?: string;
  };

  if (!body.accountId || !body.targetType || !body.targetId || !body.actionType) {
    return Response.json({ error: "accountId, targetType, targetId, actionType required" }, { status: 400 });
  }

  const rule = ensureManualRule();

  const reason = body.reason
    ?? `Manual ${humanAction(body.actionType, body.actionValue)} on ${body.targetType.toLowerCase()} ${body.targetName ?? body.targetId}`;

  const count = createSuggestions([{
    ruleId:        rule.id,
    accountId:     body.accountId,
    targetType:    body.targetType,
    targetId:      body.targetId,
    targetName:    body.targetName ?? null,
    program:       body.program ?? null,
    actionType:    body.actionType,
    actionValue:   body.actionValue ?? null,
    currentValue:  body.currentValue ?? null,
    reason,
    expectedImpact: null,
    metricSnapshot: null,
  }]);

  return Response.json({ success: true, created: count, ruleId: rule.id }, { status: 201 });
}

function humanAction(type: Action["type"], value?: number): string {
  switch (type) {
    case "PAUSE":      return "pause";
    case "ENABLE":     return "enable";
    case "SET_BID":    return `set bid to ${value ?? "?"}`;
    case "SET_BUDGET": return `set budget to ${value ?? "?"}`;
    case "BID_PCT":    return `bid ${value ?? 0}%`;
    case "BUDGET_PCT": return `budget ${value ?? 0}%`;
    case "ADD_NEGATIVE": return "add as negative";
  }
}

// Lazy create the "Manual edits" rule if missing. It's a one-time row per DB.
let _manualRuleCache: Rule | null = null;
function ensureManualRule(): Rule {
  if (_manualRuleCache) return _manualRuleCache;
  const existing = listRules({ accountId: undefined }).find((r) => r.name === MANUAL_RULE_NAME && r.accountId === null);
  if (existing) { _manualRuleCache = existing; return existing; }
  const fresh = createRule({
    name:        MANUAL_RULE_NAME,
    accountId:   null,
    objectiveId: null,
    appliesTo:   "CAMPAIGN", // dummy; real type lives on each suggestion row
    programs:    null,
    conditions:  { op: "AND", clauses: [] },
    actions:     [],
    mode:        "SUGGEST",
    enabled:     true,
  });
  _manualRuleCache = fresh;
  return fresh;
}
const MANUAL_RULE_NAME = "Manual edits (inline)";
