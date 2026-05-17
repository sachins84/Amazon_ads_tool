/**
 * Persistent campaign + ad-group daily metrics store.
 *
 * Write path: refresh-service upserts the trailing N days from Amazon.
 * Read path: overview-service + hierarchy-service query this table.
 */
import { getDb } from "./index";
import type { Program } from "@/lib/amazon-api/reports";

export interface CampaignDailyRow {
  accountId:  string;
  campaignId: string;
  date:       string;
  program:    Program;
  impressions: number;
  clicks: number;
  cost: number;
  orders: number;
  sales: number;
  topOfSearchIS?: number | null;
}

export interface AdGroupDailyRow extends Omit<CampaignDailyRow, "campaignId"> {
  campaignId: string;
  adGroupId:  string;
  adGroupName: string | null;
}

export interface CampaignMetaRow {
  accountId:    string;
  campaignId:   string;
  program:      Program;
  name:         string | null;
  state:        "ENABLED" | "PAUSED" | "ARCHIVED" | null;
  dailyBudget:  number | null;
  portfolioId:  string | null;
  targetingType: "MANUAL" | "AUTO" | null;
  brandEntityId: string | null;
}

export interface AdGroupMetaRow {
  accountId:  string;
  adGroupId:  string;
  campaignId: string;
  program:    Program;
  name:       string | null;
  state:      "ENABLED" | "PAUSED" | "ARCHIVED" | null;
  defaultBid: number | null;
}

// ─── Upserts (write path) ────────────────────────────────────────────────────

export function upsertCampaignMetrics(rows: CampaignDailyRow[]): number {
  if (rows.length === 0) return 0;
  const stmt = getDb().prepare(`
    INSERT INTO campaign_metrics_daily
      (account_id, campaign_id, date, program, impressions, clicks, cost, orders, sales, top_of_search_is, updated_at)
    VALUES (@accountId, @campaignId, @date, @program, @impressions, @clicks, @cost, @orders, @sales, @topOfSearchIS, datetime('now'))
    ON CONFLICT(account_id, campaign_id, date, program) DO UPDATE SET
      impressions      = excluded.impressions,
      clicks           = excluded.clicks,
      cost             = excluded.cost,
      orders           = excluded.orders,
      sales            = excluded.sales,
      top_of_search_is = excluded.top_of_search_is,
      updated_at       = excluded.updated_at
  `);
  const tx = getDb().transaction((items: typeof rows) => {
    for (const r of items) stmt.run({ topOfSearchIS: null, ...r });
  });
  tx(rows);
  return rows.length;
}

export function upsertAdGroupMetrics(rows: AdGroupDailyRow[]): number {
  if (rows.length === 0) return 0;
  const stmt = getDb().prepare(`
    INSERT INTO adgroup_metrics_daily
      (account_id, campaign_id, adgroup_id, adgroup_name, date, program, impressions, clicks, cost, orders, sales, updated_at)
    VALUES (@accountId, @campaignId, @adGroupId, @adGroupName, @date, @program, @impressions, @clicks, @cost, @orders, @sales, datetime('now'))
    ON CONFLICT(account_id, adgroup_id, date, program) DO UPDATE SET
      campaign_id  = excluded.campaign_id,
      adgroup_name = excluded.adgroup_name,
      impressions  = excluded.impressions,
      clicks       = excluded.clicks,
      cost         = excluded.cost,
      orders       = excluded.orders,
      sales        = excluded.sales,
      updated_at   = excluded.updated_at
  `);
  const tx = getDb().transaction((items: typeof rows) => {
    for (const r of items) stmt.run(r);
  });
  tx(rows);
  return rows.length;
}

export function upsertCampaignMeta(rows: CampaignMetaRow[]): number {
  if (rows.length === 0) return 0;
  const stmt = getDb().prepare(`
    INSERT INTO campaign_meta
      (account_id, campaign_id, program, name, state, daily_budget, portfolio_id, targeting_type, brand_entity_id, updated_at)
    VALUES (@accountId, @campaignId, @program, @name, @state, @dailyBudget, @portfolioId, @targetingType, @brandEntityId, datetime('now'))
    ON CONFLICT(account_id, campaign_id) DO UPDATE SET
      program         = excluded.program,
      name            = excluded.name,
      state           = excluded.state,
      daily_budget    = excluded.daily_budget,
      portfolio_id    = excluded.portfolio_id,
      targeting_type  = excluded.targeting_type,
      brand_entity_id = excluded.brand_entity_id,
      updated_at      = excluded.updated_at
  `);
  const tx = getDb().transaction((items: typeof rows) => {
    for (const r of items) stmt.run(r);
  });
  tx(rows);
  return rows.length;
}

export function upsertAdGroupMeta(rows: AdGroupMetaRow[]): number {
  if (rows.length === 0) return 0;
  const stmt = getDb().prepare(`
    INSERT INTO adgroup_meta
      (account_id, adgroup_id, campaign_id, program, name, state, default_bid, updated_at)
    VALUES (@accountId, @adGroupId, @campaignId, @program, @name, @state, @defaultBid, datetime('now'))
    ON CONFLICT(account_id, adgroup_id) DO UPDATE SET
      campaign_id = excluded.campaign_id,
      program     = excluded.program,
      name        = excluded.name,
      state       = excluded.state,
      default_bid = excluded.default_bid,
      updated_at  = excluded.updated_at
  `);
  const tx = getDb().transaction((items: typeof rows) => {
    for (const r of items) stmt.run(r);
  });
  tx(rows);
  return rows.length;
}

// ─── Reads ───────────────────────────────────────────────────────────────────

interface RawCampaignDailyRow {
  campaign_id: string; date: string; program: string;
  impressions: number; clicks: number; cost: number;
  orders: number; sales: number;
  top_of_search_is: number | null;
}

export function readCampaignMetrics(accountId: string, startDate: string, endDate: string): CampaignDailyRow[] {
  return (getDb()
    .prepare("SELECT campaign_id, date, program, impressions, clicks, cost, orders, sales, top_of_search_is FROM campaign_metrics_daily WHERE account_id = ? AND date BETWEEN ? AND ?")
    .all(accountId, startDate, endDate) as RawCampaignDailyRow[])
    .map((r) => ({
      accountId, campaignId: r.campaign_id, date: r.date, program: r.program as Program,
      impressions: r.impressions, clicks: r.clicks, cost: r.cost, orders: r.orders, sales: r.sales,
      topOfSearchIS: r.top_of_search_is ?? null,
    }));
}

interface RawAdGroupDailyRow {
  campaign_id: string; adgroup_id: string; adgroup_name: string | null;
  date: string; program: string;
  impressions: number; clicks: number; cost: number; orders: number; sales: number;
}

export function readAdGroupMetrics(accountId: string, startDate: string, endDate: string, campaignId?: string): AdGroupDailyRow[] {
  const sql = campaignId
    ? "SELECT campaign_id, adgroup_id, adgroup_name, date, program, impressions, clicks, cost, orders, sales FROM adgroup_metrics_daily WHERE account_id = ? AND campaign_id = ? AND date BETWEEN ? AND ?"
    : "SELECT campaign_id, adgroup_id, adgroup_name, date, program, impressions, clicks, cost, orders, sales FROM adgroup_metrics_daily WHERE account_id = ? AND date BETWEEN ? AND ?";
  const args = campaignId ? [accountId, campaignId, startDate, endDate] : [accountId, startDate, endDate];
  return (getDb().prepare(sql).all(...args) as RawAdGroupDailyRow[])
    .map((r) => ({
      accountId, campaignId: r.campaign_id, adGroupId: r.adgroup_id, adGroupName: r.adgroup_name,
      date: r.date, program: r.program as Program,
      impressions: r.impressions, clicks: r.clicks, cost: r.cost, orders: r.orders, sales: r.sales,
    }));
}

interface RawCampaignMetaRow {
  account_id: string; campaign_id: string; program: string;
  name: string | null; state: string | null; daily_budget: number | null;
  portfolio_id: string | null; targeting_type: string | null; brand_entity_id: string | null;
}

export function readCampaignMeta(accountId: string): CampaignMetaRow[] {
  return (getDb()
    .prepare("SELECT * FROM campaign_meta WHERE account_id = ?")
    .all(accountId) as RawCampaignMetaRow[])
    .map((r) => ({
      accountId: r.account_id, campaignId: r.campaign_id, program: r.program as Program,
      name: r.name,
      state: r.state as CampaignMetaRow["state"],
      dailyBudget: r.daily_budget,
      portfolioId: r.portfolio_id,
      targetingType: r.targeting_type as CampaignMetaRow["targetingType"],
      brandEntityId: r.brand_entity_id,
    }));
}

interface RawAdGroupMetaRow {
  account_id: string; adgroup_id: string; campaign_id: string; program: string;
  name: string | null; state: string | null; default_bid: number | null;
}

export function readAdGroupMeta(accountId: string, campaignId?: string): AdGroupMetaRow[] {
  const sql = campaignId
    ? "SELECT * FROM adgroup_meta WHERE account_id = ? AND campaign_id = ?"
    : "SELECT * FROM adgroup_meta WHERE account_id = ?";
  const args = campaignId ? [accountId, campaignId] : [accountId];
  return (getDb().prepare(sql).all(...args) as RawAdGroupMetaRow[])
    .map((r) => ({
      accountId: r.account_id, adGroupId: r.adgroup_id, campaignId: r.campaign_id, program: r.program as Program,
      name: r.name, state: r.state as AdGroupMetaRow["state"], defaultBid: r.default_bid,
    }));
}

// ─── Targeting (keyword + product-target) daily ──────────────────────────────

export interface TargetingDailyRow {
  accountId:  string;
  campaignId: string;
  adGroupId:  string;
  targetId:   string;
  date:       string;
  program:    Program;
  kind:       "KEYWORD" | "PRODUCT_TARGET" | "AUTO" | null;
  matchType:  "EXACT" | "PHRASE" | "BROAD" | null;
  display:    string | null;
  impressions: number;
  clicks: number;
  cost: number;
  orders: number;
  sales: number;
}

export interface TargetingMetaRow {
  accountId:  string;
  targetId:   string;
  campaignId: string;
  adGroupId:  string;
  program:    Program;
  kind:       "KEYWORD" | "PRODUCT_TARGET" | "AUTO";
  display:    string | null;
  matchType:  "EXACT" | "PHRASE" | "BROAD" | null;
  state:      "ENABLED" | "PAUSED" | "ARCHIVED" | null;
  bid:        number | null;
}

export function upsertTargetingMetrics(rows: TargetingDailyRow[]): number {
  if (rows.length === 0) return 0;
  const stmt = getDb().prepare(`
    INSERT INTO targeting_metrics_daily
      (account_id, campaign_id, adgroup_id, target_id, date, program, kind, match_type, display,
       impressions, clicks, cost, orders, sales, updated_at)
    VALUES (@accountId, @campaignId, @adGroupId, @targetId, @date, @program, @kind, @matchType, @display,
            @impressions, @clicks, @cost, @orders, @sales, datetime('now'))
    ON CONFLICT(account_id, target_id, date) DO UPDATE SET
      campaign_id = excluded.campaign_id,
      adgroup_id  = excluded.adgroup_id,
      program     = excluded.program,
      kind        = excluded.kind,
      match_type  = excluded.match_type,
      display     = excluded.display,
      impressions = excluded.impressions,
      clicks      = excluded.clicks,
      cost        = excluded.cost,
      orders      = excluded.orders,
      sales       = excluded.sales,
      updated_at  = excluded.updated_at
  `);
  const tx = getDb().transaction((items: typeof rows) => { for (const r of items) stmt.run(r); });
  tx(rows);
  return rows.length;
}

export function upsertTargetingMeta(rows: TargetingMetaRow[]): number {
  if (rows.length === 0) return 0;
  const stmt = getDb().prepare(`
    INSERT INTO targeting_meta
      (account_id, target_id, campaign_id, adgroup_id, program, kind, display, match_type, state, bid, updated_at)
    VALUES (@accountId, @targetId, @campaignId, @adGroupId, @program, @kind, @display, @matchType, @state, @bid, datetime('now'))
    ON CONFLICT(account_id, target_id) DO UPDATE SET
      campaign_id = excluded.campaign_id,
      adgroup_id  = excluded.adgroup_id,
      program     = excluded.program,
      kind        = excluded.kind,
      display     = excluded.display,
      match_type  = excluded.match_type,
      state       = excluded.state,
      bid         = excluded.bid,
      updated_at  = excluded.updated_at
  `);
  const tx = getDb().transaction((items: typeof rows) => { for (const r of items) stmt.run(r); });
  tx(rows);
  return rows.length;
}

interface RawTargetingDailyRow {
  campaign_id: string; adgroup_id: string; target_id: string; date: string; program: string;
  kind: string | null; match_type: string | null; display: string | null;
  impressions: number; clicks: number; cost: number; orders: number; sales: number;
}

export function readTargetingMetrics(accountId: string, startDate: string, endDate: string, opts: { adGroupId?: string; campaignId?: string } = {}): TargetingDailyRow[] {
  let sql = "SELECT campaign_id, adgroup_id, target_id, date, program, kind, match_type, display, impressions, clicks, cost, orders, sales FROM targeting_metrics_daily WHERE account_id = ? AND date BETWEEN ? AND ?";
  const args: unknown[] = [accountId, startDate, endDate];
  if (opts.adGroupId)  { sql += " AND adgroup_id = ?"; args.push(opts.adGroupId); }
  if (opts.campaignId) { sql += " AND campaign_id = ?"; args.push(opts.campaignId); }
  return (getDb().prepare(sql).all(...args) as RawTargetingDailyRow[])
    .map((r) => ({
      accountId, campaignId: r.campaign_id, adGroupId: r.adgroup_id, targetId: r.target_id,
      date: r.date, program: r.program as Program,
      kind: r.kind as TargetingDailyRow["kind"],
      matchType: r.match_type as TargetingDailyRow["matchType"],
      display: r.display,
      impressions: r.impressions, clicks: r.clicks, cost: r.cost, orders: r.orders, sales: r.sales,
    }));
}

interface RawTargetingMetaRow {
  account_id: string; target_id: string; campaign_id: string; adgroup_id: string; program: string;
  kind: string; display: string | null; match_type: string | null;
  state: string | null; bid: number | null;
}

export function readTargetingMeta(accountId: string, opts: { adGroupId?: string; campaignId?: string } = {}): TargetingMetaRow[] {
  let sql = "SELECT * FROM targeting_meta WHERE account_id = ?";
  const args: unknown[] = [accountId];
  if (opts.adGroupId)  { sql += " AND adgroup_id = ?"; args.push(opts.adGroupId); }
  if (opts.campaignId) { sql += " AND campaign_id = ?"; args.push(opts.campaignId); }
  return (getDb().prepare(sql).all(...args) as RawTargetingMetaRow[])
    .map((r) => ({
      accountId: r.account_id, targetId: r.target_id, campaignId: r.campaign_id, adGroupId: r.adgroup_id,
      program: r.program as Program,
      kind: r.kind as TargetingMetaRow["kind"],
      display: r.display, matchType: r.match_type as TargetingMetaRow["matchType"],
      state: r.state as TargetingMetaRow["state"], bid: r.bid,
    }));
}

// ─── Refresh state ───────────────────────────────────────────────────────────

export type RefreshLevel = "campaigns" | "adgroups" | "targeting";

export interface RefreshStateRow {
  accountId: string;
  level: RefreshLevel;
  lastRefreshAt: string;
  windowStart: string;
  windowEnd: string;
  rowsUpserted: number;
  durationMs: number | null;
  error: string | null;
}

export function setRefreshState(input: Omit<RefreshStateRow, never>): void {
  getDb().prepare(`
    INSERT INTO account_refresh_state (account_id, level, last_refresh_at, window_start, window_end, rows_upserted, duration_ms, error)
    VALUES (@accountId, @level, @lastRefreshAt, @windowStart, @windowEnd, @rowsUpserted, @durationMs, @error)
    ON CONFLICT(account_id, level) DO UPDATE SET
      last_refresh_at = excluded.last_refresh_at,
      window_start    = excluded.window_start,
      window_end      = excluded.window_end,
      rows_upserted   = excluded.rows_upserted,
      duration_ms     = excluded.duration_ms,
      error           = excluded.error
  `).run(input);
}

interface RawRefreshStateRow {
  account_id: string; level: string;
  last_refresh_at: string; window_start: string; window_end: string;
  rows_upserted: number; duration_ms: number | null; error: string | null;
}

export function getRefreshState(accountId: string, level: RefreshLevel): RefreshStateRow | null {
  const row = getDb()
    .prepare("SELECT * FROM account_refresh_state WHERE account_id = ? AND level = ?")
    .get(accountId, level) as RawRefreshStateRow | undefined;
  if (!row) return null;
  return {
    accountId: row.account_id, level: row.level as RefreshLevel,
    lastRefreshAt: row.last_refresh_at, windowStart: row.window_start, windowEnd: row.window_end,
    rowsUpserted: row.rows_upserted, durationMs: row.duration_ms, error: row.error,
  };
}

export function listRefreshStates(): RefreshStateRow[] {
  return (getDb()
    .prepare("SELECT * FROM account_refresh_state")
    .all() as RawRefreshStateRow[])
    .map((row) => ({
      accountId: row.account_id, level: row.level as RefreshLevel,
      lastRefreshAt: row.last_refresh_at, windowStart: row.window_start, windowEnd: row.window_end,
      rowsUpserted: row.rows_upserted, durationMs: row.duration_ms, error: row.error,
    }));
}

// ─── Coverage check ──────────────────────────────────────────────────────────
// Returns the min/max dates we already have stored for an account.

export function campaignMetricsCoverage(accountId: string): { min: string | null; max: string | null; rowCount: number } {
  const r = getDb()
    .prepare("SELECT MIN(date) AS min, MAX(date) AS max, COUNT(*) AS n FROM campaign_metrics_daily WHERE account_id = ?")
    .get(accountId) as { min: string | null; max: string | null; n: number };
  return { min: r.min, max: r.max, rowCount: r.n };
}
