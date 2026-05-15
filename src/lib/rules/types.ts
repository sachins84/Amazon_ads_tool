/**
 * Shared types for the objective + rule + suggestion model.
 *
 * Stored as JSON in SQLite text columns — kept dependency-free so this file
 * is safe to import from both server and (theoretically) client.
 */

export type Metric =
  | "SPEND"
  | "SALES"
  | "ORDERS"
  | "ROAS"
  | "ACOS"
  | "CTR"
  | "CPC"
  | "CVR"
  | "IMPRESSIONS"
  | "CLICKS";

export type Comparator =
  | "GT" | "GTE" | "LT" | "LTE" | "EQ" | "NEQ";

export type AppliesTo = "CAMPAIGN" | "AD_GROUP" | "KEYWORD" | "PRODUCT_TARGET";

export type Program = "SP" | "SB" | "SD";

export interface Clause {
  metric: Metric;
  op: Comparator;
  value: number;
}

export interface ConditionTree {
  op: "AND" | "OR";
  clauses: (Clause | ConditionTree)[];
}

export type Action =
  | { type: "PAUSE" }
  | { type: "ENABLE" }
  | { type: "SET_BID";       value: number }
  | { type: "BID_PCT";       value: number; floor?: number; ceiling?: number }
  | { type: "SET_BUDGET";    value: number }
  | { type: "BUDGET_PCT";    value: number; floor?: number; ceiling?: number }
  | { type: "ADD_NEGATIVE" };

export type RuleMode = "SUGGEST" | "AUTO_APPLY";

export interface Rule {
  id: string;
  name: string;
  accountId: string | null;
  objectiveId: string | null;
  appliesTo: AppliesTo;
  programs: Program[] | null;
  conditions: ConditionTree;
  actions: Action[];
  mode: RuleMode;
  enabled: boolean;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Objective {
  id: string;
  name: string;
  accountId: string | null;
  scopeFilter: { campaignIds?: string[]; programs?: Program[]; portfolioIds?: string[] } | null;
  targetMetric: Metric;
  comparator: "GTE" | "LTE" | "EQ";
  targetValue: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type SuggestionStatus = "PENDING" | "APPROVED" | "DISMISSED" | "APPLIED" | "FAILED";

export interface Suggestion {
  id: string;
  ruleId: string;
  accountId: string;
  targetType: AppliesTo;
  targetId: string;
  targetName: string | null;
  program: Program | null;
  actionType: Action["type"];
  actionValue: number | null;
  currentValue: number | null;
  reason: string;
  expectedImpact: { savedSpend?: number; addedSales?: number; addedOrders?: number; note?: string } | null;
  metricSnapshot: Record<string, number> | null;
  status: SuggestionStatus;
  appliedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Dataset rows the engine evaluates over ──────────────────────────────────

export interface MetricRow {
  /** Stable identifier — campaignId, adGroupId, keywordId, targetId */
  id: string;
  name: string | null;
  program: Program | null;
  campaignId: string | null;
  adGroupId: string | null;
  /** Either a bid (for keywords/targets) or a budget (for campaigns) */
  currentValue: number | null;
  spend: number;
  sales: number;
  orders: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cvr: number;
  acos: number;
  roas: number;
}
