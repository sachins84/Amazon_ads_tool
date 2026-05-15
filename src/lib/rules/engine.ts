/**
 * Pure rule evaluation engine.
 *
 * evaluateRule(rule, rows) → suggestions[]
 * No DB / API access — caller provides the metric rows. This lets the engine
 * be exercised in tests against any dataset shape.
 */
import type {
  Rule, Action, Clause, ConditionTree, Comparator, Metric, MetricRow,
  Suggestion, SuggestionStatus,
} from "./types";

// ─── Public API ──────────────────────────────────────────────────────────────

export interface EvaluatedSuggestion {
  ruleId: string;
  targetId: string;
  targetName: string | null;
  targetType: Rule["appliesTo"];
  program: MetricRow["program"];
  actionType: Action["type"];
  actionValue: number | null;
  currentValue: number | null;
  reason: string;
  expectedImpact: Suggestion["expectedImpact"];
  metricSnapshot: Record<string, number>;
}

export function evaluateRule(rule: Rule, rows: MetricRow[]): EvaluatedSuggestion[] {
  const matched = rows.filter((r) => programMatches(rule, r) && conditionMatches(rule.conditions, r));
  const out: EvaluatedSuggestion[] = [];

  for (const r of matched) {
    for (const action of rule.actions) {
      const { actionValue, expectedImpact, reasonAddon } = projectAction(action, r);
      out.push({
        ruleId: rule.id,
        targetId: r.id,
        targetName: r.name,
        targetType: rule.appliesTo,
        program: r.program,
        actionType: action.type,
        actionValue,
        currentValue: r.currentValue,
        reason: buildReason(rule, r, action) + (reasonAddon ? ` — ${reasonAddon}` : ""),
        expectedImpact,
        metricSnapshot: snapshot(r),
      });
    }
  }
  return out;
}

// ─── Condition tree ──────────────────────────────────────────────────────────

function programMatches(rule: Rule, row: MetricRow): boolean {
  if (!rule.programs || rule.programs.length === 0) return true;
  return row.program != null && rule.programs.includes(row.program);
}

function conditionMatches(node: ConditionTree | Clause, row: MetricRow): boolean {
  if ("metric" in node) return clauseMatches(node, row);
  if (node.op === "AND") return node.clauses.every((c) => conditionMatches(c, row));
  return node.clauses.some((c) => conditionMatches(c, row));
}

function clauseMatches(c: Clause, row: MetricRow): boolean {
  const v = metricValue(c.metric, row);
  return compare(v, c.op, c.value);
}

function compare(a: number, op: Comparator, b: number): boolean {
  switch (op) {
    case "GT":  return a >  b;
    case "GTE": return a >= b;
    case "LT":  return a <  b;
    case "LTE": return a <= b;
    case "EQ":  return a === b;
    case "NEQ": return a !== b;
  }
}

function metricValue(m: Metric, row: MetricRow): number {
  switch (m) {
    case "SPEND":       return row.spend;
    case "SALES":       return row.sales;
    case "ORDERS":      return row.orders;
    case "ROAS":        return row.roas;
    case "ACOS":        return row.acos;
    case "CTR":         return row.ctr;
    case "CPC":         return row.cpc;
    case "CVR":         return row.cvr;
    case "IMPRESSIONS": return row.impressions;
    case "CLICKS":      return row.clicks;
  }
}

// ─── Action projection ───────────────────────────────────────────────────────

function projectAction(action: Action, row: MetricRow): {
  actionValue: number | null;
  expectedImpact: Suggestion["expectedImpact"];
  reasonAddon?: string;
} {
  switch (action.type) {
    case "PAUSE": {
      return {
        actionValue: null,
        expectedImpact: {
          savedSpend: row.spend > 0 ? round2(row.spend) : undefined,
          addedSales: row.sales > 0 ? -round2(row.sales) : undefined,
          addedOrders: row.orders > 0 ? -row.orders : undefined,
          note: "Estimated by extrapolating current period spend/sales to zero.",
        },
      };
    }
    case "ENABLE": {
      return { actionValue: null, expectedImpact: { note: "Resuming this entity." } };
    }
    case "SET_BID": {
      const newBid = action.value;
      return {
        actionValue: round2(newBid),
        expectedImpact: {
          note: row.currentValue != null
            ? `Bid ${row.currentValue.toFixed(2)} → ${newBid.toFixed(2)}`
            : `Bid set to ${newBid.toFixed(2)}`,
        },
      };
    }
    case "BID_PCT": {
      const cur = row.currentValue ?? 0;
      let next = cur * (1 + action.value / 100);
      if (action.floor != null)   next = Math.max(next, action.floor);
      if (action.ceiling != null) next = Math.min(next, action.ceiling);
      next = round2(Math.max(next, 0.02));
      return {
        actionValue: next,
        expectedImpact: {
          note: `Bid ${cur.toFixed(2)} ${action.value >= 0 ? "↑" : "↓"} ${Math.abs(action.value)}% → ${next.toFixed(2)}`,
        },
      };
    }
    case "SET_BUDGET": {
      return {
        actionValue: round2(action.value),
        expectedImpact: {
          note: row.currentValue != null
            ? `Budget ${row.currentValue.toFixed(2)} → ${action.value.toFixed(2)}`
            : `Budget set to ${action.value.toFixed(2)}`,
        },
      };
    }
    case "BUDGET_PCT": {
      const cur = row.currentValue ?? 0;
      let next = cur * (1 + action.value / 100);
      if (action.floor != null)   next = Math.max(next, action.floor);
      if (action.ceiling != null) next = Math.min(next, action.ceiling);
      next = round2(next);
      return {
        actionValue: next,
        expectedImpact: {
          note: `Budget ${cur.toFixed(2)} ${action.value >= 0 ? "↑" : "↓"} ${Math.abs(action.value)}% → ${next.toFixed(2)}`,
        },
      };
    }
    case "ADD_NEGATIVE": {
      return {
        actionValue: null,
        expectedImpact: {
          savedSpend: row.spend > 0 ? round2(row.spend) : undefined,
          note: "Add as negative keyword to prevent future spend on this term.",
        },
      };
    }
  }
}

// ─── Reasoning ───────────────────────────────────────────────────────────────

function buildReason(rule: Rule, row: MetricRow, action: Action): string {
  const clauses = flattenClauses(rule.conditions);
  const parts = clauses.map((c) =>
    `${c.metric} ${humanOp(c.op)} ${c.value}  (now ${formatMetric(c.metric, metricValue(c.metric, row))})`
  );
  return `${actionLabel(action)} because ${parts.join(" AND ")}`;
}

function flattenClauses(node: ConditionTree | Clause, acc: Clause[] = []): Clause[] {
  if ("metric" in node) { acc.push(node); return acc; }
  for (const c of node.clauses) flattenClauses(c, acc);
  return acc;
}

function humanOp(op: Comparator): string {
  return { GT: ">", GTE: "≥", LT: "<", LTE: "≤", EQ: "=", NEQ: "≠" }[op];
}

function actionLabel(a: Action): string {
  switch (a.type) {
    case "PAUSE":        return "Pause";
    case "ENABLE":       return "Enable";
    case "SET_BID":      return `Set bid to ${a.value}`;
    case "BID_PCT":      return `${a.value >= 0 ? "Raise" : "Lower"} bid by ${Math.abs(a.value)}%`;
    case "SET_BUDGET":   return `Set budget to ${a.value}`;
    case "BUDGET_PCT":   return `${a.value >= 0 ? "Raise" : "Lower"} budget by ${Math.abs(a.value)}%`;
    case "ADD_NEGATIVE": return "Add as negative";
  }
}

function formatMetric(m: Metric, v: number): string {
  if (m === "ROAS") return `${v.toFixed(2)}x`;
  if (m === "ACOS" || m === "CTR" || m === "CVR") return `${v.toFixed(1)}%`;
  if (m === "SPEND" || m === "SALES" || m === "CPC") return v.toFixed(2);
  return Math.round(v).toString();
}

function snapshot(row: MetricRow): Record<string, number> {
  return {
    spend: row.spend, sales: row.sales, orders: row.orders,
    impressions: row.impressions, clicks: row.clicks,
    ctr: row.ctr, cpc: row.cpc, cvr: row.cvr, acos: row.acos, roas: row.roas,
  };
}

function round2(n: number) { return Math.round(n * 100) / 100; }

// ─── Status helpers ──────────────────────────────────────────────────────────

export function isTerminalSuggestionStatus(s: SuggestionStatus): boolean {
  return s === "APPLIED" || s === "DISMISSED" || s === "FAILED";
}
