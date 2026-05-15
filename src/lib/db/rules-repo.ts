/**
 * CRUD for objectives, rules, suggestions.
 */
import { v4 as uuidv4 } from "uuid";
import { getDb } from "./index";
import type {
  Action, AppliesTo, ConditionTree, Objective, Program, Rule, RuleMode,
  Suggestion, SuggestionStatus,
} from "@/lib/rules/types";

// ─── Objectives ──────────────────────────────────────────────────────────────

interface ObjectiveRow {
  id: string; name: string; account_id: string | null;
  scope_filter: string | null;
  target_metric: string; comparator: string; target_value: number;
  enabled: number; created_at: string; updated_at: string;
}
function rowToObjective(r: ObjectiveRow): Objective {
  return {
    id: r.id, name: r.name, accountId: r.account_id,
    scopeFilter: r.scope_filter ? JSON.parse(r.scope_filter) : null,
    targetMetric: r.target_metric as Objective["targetMetric"],
    comparator: r.comparator as Objective["comparator"],
    targetValue: r.target_value, enabled: r.enabled === 1,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export function listObjectives(filter: { accountId?: string } = {}): Objective[] {
  const db = getDb();
  const rows = filter.accountId
    ? db.prepare("SELECT * FROM objectives WHERE account_id = ? OR account_id IS NULL ORDER BY created_at DESC").all(filter.accountId) as ObjectiveRow[]
    : db.prepare("SELECT * FROM objectives ORDER BY created_at DESC").all() as ObjectiveRow[];
  return rows.map(rowToObjective);
}

export function createObjective(input: Omit<Objective, "id" | "createdAt" | "updatedAt">): Objective {
  const id = uuidv4();
  getDb().prepare(`
    INSERT INTO objectives (id, name, account_id, scope_filter, target_metric, comparator, target_value, enabled)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(
    id, input.name, input.accountId,
    input.scopeFilter ? JSON.stringify(input.scopeFilter) : null,
    input.targetMetric, input.comparator, input.targetValue,
    input.enabled ? 1 : 0,
  );
  return rowToObjective(getDb().prepare("SELECT * FROM objectives WHERE id = ?").get(id) as ObjectiveRow);
}

export function updateObjective(id: string, patch: Partial<Omit<Objective, "id">>): Objective | null {
  const existing = getDb().prepare("SELECT * FROM objectives WHERE id = ?").get(id) as ObjectiveRow | undefined;
  if (!existing) return null;
  const fields: string[] = ["updated_at = datetime('now')"];
  const params: Record<string, unknown> = { id };
  if (patch.name        !== undefined) { fields.push("name = @name");                params.name = patch.name; }
  if (patch.accountId   !== undefined) { fields.push("account_id = @accountId");     params.accountId = patch.accountId; }
  if (patch.scopeFilter !== undefined) { fields.push("scope_filter = @scopeFilter"); params.scopeFilter = patch.scopeFilter ? JSON.stringify(patch.scopeFilter) : null; }
  if (patch.targetMetric!== undefined) { fields.push("target_metric = @targetMetric"); params.targetMetric = patch.targetMetric; }
  if (patch.comparator  !== undefined) { fields.push("comparator = @comparator");    params.comparator = patch.comparator; }
  if (patch.targetValue !== undefined) { fields.push("target_value = @targetValue"); params.targetValue = patch.targetValue; }
  if (patch.enabled     !== undefined) { fields.push("enabled = @enabled");          params.enabled = patch.enabled ? 1 : 0; }
  getDb().prepare(`UPDATE objectives SET ${fields.join(", ")} WHERE id = @id`).run(params);
  return rowToObjective(getDb().prepare("SELECT * FROM objectives WHERE id = ?").get(id) as ObjectiveRow);
}

export function deleteObjective(id: string): boolean {
  return getDb().prepare("DELETE FROM objectives WHERE id = ?").run(id).changes > 0;
}

// ─── Rules ───────────────────────────────────────────────────────────────────

interface RuleRow {
  id: string; name: string; account_id: string | null; objective_id: string | null;
  applies_to: string; programs: string | null;
  conditions: string; actions: string;
  mode: string; enabled: number; last_run_at: string | null;
  created_at: string; updated_at: string;
}
function rowToRule(r: RuleRow): Rule {
  return {
    id: r.id, name: r.name, accountId: r.account_id, objectiveId: r.objective_id,
    appliesTo: r.applies_to as AppliesTo,
    programs:   r.programs   ? JSON.parse(r.programs)   as Program[] : null,
    conditions: JSON.parse(r.conditions) as ConditionTree,
    actions:    JSON.parse(r.actions)    as Action[],
    mode: r.mode as RuleMode,
    enabled: r.enabled === 1,
    lastRunAt: r.last_run_at,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export function listRules(filter: { accountId?: string; enabledOnly?: boolean } = {}): Rule[] {
  const db = getDb();
  let sql = "SELECT * FROM rules";
  const wheres: string[] = [];
  const args: unknown[] = [];
  if (filter.accountId)   { wheres.push("(account_id = ? OR account_id IS NULL)"); args.push(filter.accountId); }
  if (filter.enabledOnly) { wheres.push("enabled = 1"); }
  if (wheres.length) sql += " WHERE " + wheres.join(" AND ");
  sql += " ORDER BY created_at DESC";
  return (db.prepare(sql).all(...args) as RuleRow[]).map(rowToRule);
}

export function getRule(id: string): Rule | null {
  const row = getDb().prepare("SELECT * FROM rules WHERE id = ?").get(id) as RuleRow | undefined;
  return row ? rowToRule(row) : null;
}

export function createRule(input: Omit<Rule, "id" | "createdAt" | "updatedAt" | "lastRunAt">): Rule {
  const id = uuidv4();
  getDb().prepare(`
    INSERT INTO rules (id, name, account_id, objective_id, applies_to, programs, conditions, actions, mode, enabled)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, input.name, input.accountId, input.objectiveId,
    input.appliesTo,
    input.programs ? JSON.stringify(input.programs) : null,
    JSON.stringify(input.conditions),
    JSON.stringify(input.actions),
    input.mode,
    input.enabled ? 1 : 0,
  );
  return getRule(id)!;
}

export function updateRule(id: string, patch: Partial<Omit<Rule, "id" | "createdAt">>): Rule | null {
  const existing = getRule(id);
  if (!existing) return null;
  const fields: string[] = ["updated_at = datetime('now')"];
  const params: Record<string, unknown> = { id };
  if (patch.name        !== undefined) { fields.push("name = @name");                params.name = patch.name; }
  if (patch.accountId   !== undefined) { fields.push("account_id = @accountId");     params.accountId = patch.accountId; }
  if (patch.objectiveId !== undefined) { fields.push("objective_id = @objectiveId"); params.objectiveId = patch.objectiveId; }
  if (patch.appliesTo   !== undefined) { fields.push("applies_to = @appliesTo");     params.appliesTo = patch.appliesTo; }
  if (patch.programs    !== undefined) { fields.push("programs = @programs");        params.programs = patch.programs ? JSON.stringify(patch.programs) : null; }
  if (patch.conditions  !== undefined) { fields.push("conditions = @conditions");    params.conditions = JSON.stringify(patch.conditions); }
  if (patch.actions     !== undefined) { fields.push("actions = @actions");          params.actions = JSON.stringify(patch.actions); }
  if (patch.mode        !== undefined) { fields.push("mode = @mode");                params.mode = patch.mode; }
  if (patch.enabled     !== undefined) { fields.push("enabled = @enabled");          params.enabled = patch.enabled ? 1 : 0; }
  if (patch.lastRunAt   !== undefined) { fields.push("last_run_at = @lastRunAt");    params.lastRunAt = patch.lastRunAt; }
  getDb().prepare(`UPDATE rules SET ${fields.join(", ")} WHERE id = @id`).run(params);
  return getRule(id);
}

export function deleteRule(id: string): boolean {
  return getDb().prepare("DELETE FROM rules WHERE id = ?").run(id).changes > 0;
}

// ─── Suggestions ─────────────────────────────────────────────────────────────

interface SuggestionRow {
  id: string; rule_id: string; account_id: string;
  target_type: string; target_id: string; target_name: string | null;
  program: string | null;
  action_type: string; action_value: number | null;
  current_value: number | null;
  reason: string;
  expected_impact_json: string | null;
  metric_snapshot_json: string | null;
  status: string;
  applied_at: string | null;
  created_at: string; updated_at: string;
}
function rowToSuggestion(r: SuggestionRow): Suggestion {
  return {
    id: r.id, ruleId: r.rule_id, accountId: r.account_id,
    targetType: r.target_type as AppliesTo, targetId: r.target_id, targetName: r.target_name,
    program: r.program as Program | null,
    actionType: r.action_type as Action["type"],
    actionValue: r.action_value, currentValue: r.current_value,
    reason: r.reason,
    expectedImpact: r.expected_impact_json ? JSON.parse(r.expected_impact_json) : null,
    metricSnapshot: r.metric_snapshot_json ? JSON.parse(r.metric_snapshot_json) : null,
    status: r.status as SuggestionStatus,
    appliedAt: r.applied_at,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export function listSuggestions(filter: {
  accountId?: string; status?: SuggestionStatus | "ANY"; ruleId?: string; limit?: number;
} = {}): Suggestion[] {
  const wheres: string[] = [];
  const args: unknown[] = [];
  if (filter.accountId) { wheres.push("account_id = ?"); args.push(filter.accountId); }
  if (filter.ruleId)    { wheres.push("rule_id = ?");    args.push(filter.ruleId); }
  if (filter.status && filter.status !== "ANY") { wheres.push("status = ?"); args.push(filter.status); }
  let sql = "SELECT * FROM suggestions";
  if (wheres.length) sql += " WHERE " + wheres.join(" AND ");
  sql += " ORDER BY created_at DESC LIMIT ?";
  args.push(filter.limit ?? 500);
  return (getDb().prepare(sql).all(...args) as SuggestionRow[]).map(rowToSuggestion);
}

export function createSuggestions(rows: Omit<Suggestion, "id" | "status" | "appliedAt" | "createdAt" | "updatedAt">[]): number {
  if (rows.length === 0) return 0;
  const stmt = getDb().prepare(`
    INSERT INTO suggestions
      (id, rule_id, account_id, target_type, target_id, target_name, program,
       action_type, action_value, current_value, reason,
       expected_impact_json, metric_snapshot_json, status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'PENDING')
  `);
  const tx = getDb().transaction((items: typeof rows) => {
    for (const s of items) {
      stmt.run(
        uuidv4(), s.ruleId, s.accountId, s.targetType, s.targetId, s.targetName, s.program,
        s.actionType, s.actionValue, s.currentValue, s.reason,
        s.expectedImpact ? JSON.stringify(s.expectedImpact) : null,
        s.metricSnapshot ? JSON.stringify(s.metricSnapshot) : null,
      );
    }
  });
  tx(rows);
  return rows.length;
}

export function updateSuggestionStatus(id: string, status: SuggestionStatus): boolean {
  const stamp = (status === "APPLIED") ? "datetime('now')" : "NULL";
  return getDb()
    .prepare(`UPDATE suggestions SET status = ?, applied_at = ${stamp}, updated_at = datetime('now') WHERE id = ?`)
    .run(status, id).changes > 0;
}

export function recordSuggestionRun(input: { ruleId: string; accountId: string; suggestionsCreated: number; error?: string }) {
  getDb().prepare(`
    INSERT INTO suggestion_runs (id, rule_id, account_id, suggestions_created, error)
    VALUES (?,?,?,?,?)
  `).run(uuidv4(), input.ruleId, input.accountId, input.suggestionsCreated, input.error ?? null);
}

/**
 * For each target_id under an account, return the MOST RECENT non-PENDING
 * suggestion. Used by the Targeting 360 'Last Action' column so reviewers
 * can see what's already been acted on.
 */
export interface LastAction {
  suggestionId: string;
  targetId: string;
  status: SuggestionStatus;       // APPLIED | APPROVED | DISMISSED | FAILED
  actionType: Suggestion["actionType"];
  actionValue: number | null;
  at: string;                     // updated_at (when the decision was made)
}

interface LastActionRow {
  id: string; target_id: string; status: string;
  action_type: string; action_value: number | null; updated_at: string;
}

export function getLastActionsByTarget(accountId: string): Record<string, LastAction> {
  // SQLite: pick the row with max updated_at per target_id where status != PENDING
  const rows = getDb().prepare(`
    SELECT s.id, s.target_id, s.status, s.action_type, s.action_value, s.updated_at
      FROM suggestions s
      INNER JOIN (
        SELECT target_id, MAX(updated_at) AS max_at
          FROM suggestions
         WHERE account_id = ? AND status != 'PENDING'
      GROUP BY target_id
      ) latest
      ON s.target_id = latest.target_id AND s.updated_at = latest.max_at
     WHERE s.account_id = ? AND s.status != 'PENDING'
  `).all(accountId, accountId) as LastActionRow[];

  const out: Record<string, LastAction> = {};
  for (const r of rows) {
    out[r.target_id] = {
      suggestionId: r.id,
      targetId: r.target_id,
      status: r.status as SuggestionStatus,
      actionType: r.action_type as Suggestion["actionType"],
      actionValue: r.action_value,
      at: r.updated_at,
    };
  }
  return out;
}
