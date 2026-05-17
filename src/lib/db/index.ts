/**
 * SQLite database — stores account configs and OAuth tokens.
 * File lives at ./data/amazon-ads.db (git-ignored).
 */
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH  = path.join(DATA_DIR, "amazon-ads.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  migrate(_db);
  return _db;
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id                  TEXT PRIMARY KEY,
      name                TEXT NOT NULL,
      color               TEXT NOT NULL DEFAULT '#6366f1',

      -- Amazon Ads API
      ads_client_id       TEXT NOT NULL,
      ads_client_secret   TEXT NOT NULL,        -- encrypted
      ads_refresh_token   TEXT NOT NULL,        -- encrypted
      ads_endpoint        TEXT NOT NULL DEFAULT 'https://advertising-api.amazon.com',
      ads_profile_id      TEXT NOT NULL,
      ads_marketplace     TEXT NOT NULL DEFAULT 'US',

      -- Seller Central SP-API (optional)
      sp_refresh_token    TEXT,                 -- encrypted, nullable
      sp_marketplace_id   TEXT,
      sp_endpoint         TEXT DEFAULT 'https://sellingpartnerapi-na.amazon.com',

      -- Status
      connected           INTEGER NOT NULL DEFAULT 0,
      last_synced_at      TEXT,
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS account_tokens (
      account_id          TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      token_type          TEXT NOT NULL,        -- 'ads' | 'sp'
      access_token        TEXT NOT NULL,        -- encrypted
      expires_at          INTEGER NOT NULL,     -- unix ms
      PRIMARY KEY (account_id, token_type)
    );

    -- ─── Objectives ──────────────────────────────────────────────────────
    -- A goal you're pursuing on one (or all) accounts. Drives rule ordering.
    CREATE TABLE IF NOT EXISTS objectives (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      account_id      TEXT REFERENCES accounts(id) ON DELETE CASCADE, -- null = all accounts
      scope_filter    TEXT,                -- JSON: { campaignIds?, programs?, portfolioIds? }
      target_metric   TEXT NOT NULL,       -- 'ROAS' | 'ACOS' | 'SPEND' | 'SALES' | 'ORDERS' | 'CPC' | 'CTR' | 'CVR'
      comparator      TEXT NOT NULL,       -- 'GTE' | 'LTE' | 'EQ'
      target_value    REAL NOT NULL,
      enabled         INTEGER NOT NULL DEFAULT 1,
      -- ─── Optimizer config ─── added for the AI optimization engine.
      target_roas         REAL,             -- desired ROAS floor (e.g. 2.5x)
      max_scale_up_pct    REAL DEFAULT 20,  -- cap on budget/bid increases
      max_scale_down_pct  REAL DEFAULT 30,  -- cap on budget/bid decreases
      min_spend_threshold REAL DEFAULT 100, -- ignore entities below this spend
      pause_when_orders_zero_days INTEGER DEFAULT 7,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Optimizer run audit log — drives "evolve over time" by letting future
    -- runs see what was suggested/applied and what happened next.
    CREATE TABLE IF NOT EXISTS optimization_runs (
      id              TEXT PRIMARY KEY,
      account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      objective_id    TEXT REFERENCES objectives(id) ON DELETE SET NULL,
      window_label    TEXT,                 -- e.g. "1d/3d/7d"
      entities_scored INTEGER NOT NULL,
      suggestions_created INTEGER NOT NULL,
      error           TEXT,
      run_at          TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ─── Rules ──────────────────────────────────────────────────────────
    -- IF (conditions) THEN (actions) — applied to campaigns/adGroups/keywords/targets.
    CREATE TABLE IF NOT EXISTS rules (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      account_id      TEXT REFERENCES accounts(id) ON DELETE CASCADE, -- null = all accounts
      objective_id    TEXT REFERENCES objectives(id) ON DELETE SET NULL,
      applies_to      TEXT NOT NULL,       -- 'CAMPAIGN' | 'AD_GROUP' | 'KEYWORD' | 'PRODUCT_TARGET'
      programs        TEXT,                -- JSON ['SP','SB','SD'] or null = all
      conditions      TEXT NOT NULL,       -- JSON: { op: 'AND'|'OR', clauses: [{metric, op, value, window}, ...] }
      actions         TEXT NOT NULL,       -- JSON: [{type, value, etc}]
      mode            TEXT NOT NULL DEFAULT 'SUGGEST',  -- 'SUGGEST' | 'AUTO_APPLY'
      enabled         INTEGER NOT NULL DEFAULT 1,
      last_run_at     TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ─── Suggestions ─────────────────────────────────────────────────────
    -- The output of a rule evaluation, waiting for user action.
    CREATE TABLE IF NOT EXISTS suggestions (
      id              TEXT PRIMARY KEY,
      rule_id         TEXT NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
      account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      target_type     TEXT NOT NULL,       -- 'CAMPAIGN' | 'AD_GROUP' | 'KEYWORD' | 'PRODUCT_TARGET'
      target_id       TEXT NOT NULL,
      target_name     TEXT,
      program         TEXT,                -- 'SP' | 'SB' | 'SD'
      action_type     TEXT NOT NULL,       -- 'PAUSE' | 'ENABLE' | 'SET_BID' | 'BID_PCT' | 'SET_BUDGET' | 'BUDGET_PCT' | 'ADD_NEGATIVE'
      action_value    REAL,                -- numeric value where applicable
      current_value   REAL,                -- current bid/budget for context
      reason          TEXT NOT NULL,       -- human-readable explanation
      expected_impact_json TEXT,           -- JSON {savedSpend?, addedSales?, ...}
      metric_snapshot_json TEXT,           -- JSON snapshot of metrics that triggered
      status          TEXT NOT NULL DEFAULT 'PENDING',  -- 'PENDING' | 'APPROVED' | 'DISMISSED' | 'APPLIED' | 'FAILED' | 'HELD'
      applied_at      TEXT,
      -- Optimizer fields
      bucket          TEXT,                -- 'SCALE_UP' | 'SCALE_DOWN' | 'PAUSE' | 'BID_UP' | 'BID_DOWN' | 'HOLD'
      signals_json    TEXT,                -- JSON: {roas1d, roas3d, roas7d, trend, impressionShare, cpc, ...}
      override_value  REAL,                -- reviewer's override of action_value before apply
      reviewer        TEXT,                -- who approved/dismissed (display name)
      decision_note   TEXT,                -- reviewer note
      confidence      REAL,                -- 0..1 — engine's confidence
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ─── Suggestion outcomes ─────────────────────────────────────────────
    -- For each APPLIED suggestion we snapshot the (sum) metrics in the
    -- N days BEFORE apply_date and the N days AFTER, so the optimizer can
    -- score itself retroactively. One row per (suggestion_id, window_days).
    CREATE TABLE IF NOT EXISTS suggestion_outcomes (
      suggestion_id   TEXT NOT NULL REFERENCES suggestions(id) ON DELETE CASCADE,
      window_days     INTEGER NOT NULL,    -- 1, 3, 7, 14
      spend_before    REAL NOT NULL DEFAULT 0,
      sales_before    REAL NOT NULL DEFAULT 0,
      orders_before   INTEGER NOT NULL DEFAULT 0,
      roas_before     REAL,
      spend_after     REAL NOT NULL DEFAULT 0,
      sales_after     REAL NOT NULL DEFAULT 0,
      orders_after    INTEGER NOT NULL DEFAULT 0,
      roas_after      REAL,
      captured_at     TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (suggestion_id, window_days)
    );
    CREATE INDEX IF NOT EXISTS idx_sugg_outcomes_captured ON suggestion_outcomes (captured_at);

    -- ─── Suggestion runs (audit log) ─────────────────────────────────────
    CREATE TABLE IF NOT EXISTS suggestion_runs (
      id              TEXT PRIMARY KEY,
      rule_id         TEXT NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
      account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      suggestions_created INTEGER NOT NULL,
      error           TEXT,
      run_at          TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_suggestions_status      ON suggestions (status);
    CREATE INDEX IF NOT EXISTS idx_suggestions_account     ON suggestions (account_id, status);
    CREATE INDEX IF NOT EXISTS idx_rules_account           ON rules (account_id, enabled);
    CREATE INDEX IF NOT EXISTS idx_objectives_account      ON objectives (account_id, enabled);

    -- ─── Persistent metrics store (so we don't re-pull stable history) ──
    -- One row per (account, campaign, date, program). Older data sits here
    -- forever; the daily 8 AM refresh re-pulls only the trailing 14 days
    -- to capture Amazon's attribution backfill window.
    CREATE TABLE IF NOT EXISTS campaign_metrics_daily (
      account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      campaign_id  TEXT NOT NULL,
      date         TEXT NOT NULL,        -- YYYY-MM-DD
      program      TEXT NOT NULL,        -- 'SP' | 'SB' | 'SD'
      impressions  INTEGER NOT NULL DEFAULT 0,
      clicks       INTEGER NOT NULL DEFAULT 0,
      cost         REAL    NOT NULL DEFAULT 0,
      orders       INTEGER NOT NULL DEFAULT 0,
      sales        REAL    NOT NULL DEFAULT 0,
      top_of_search_is REAL,             -- top-of-search impression share (0..100); nullable
      updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (account_id, campaign_id, date, program)
    );
    CREATE INDEX IF NOT EXISTS idx_cmd_account_date ON campaign_metrics_daily (account_id, date);

    CREATE TABLE IF NOT EXISTS adgroup_metrics_daily (
      account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      campaign_id  TEXT NOT NULL,
      adgroup_id   TEXT NOT NULL,
      adgroup_name TEXT,
      date         TEXT NOT NULL,
      program      TEXT NOT NULL,
      impressions  INTEGER NOT NULL DEFAULT 0,
      clicks       INTEGER NOT NULL DEFAULT 0,
      cost         REAL    NOT NULL DEFAULT 0,
      orders       INTEGER NOT NULL DEFAULT 0,
      sales        REAL    NOT NULL DEFAULT 0,
      updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (account_id, adgroup_id, date, program)
    );
    CREATE INDEX IF NOT EXISTS idx_amd_account_date     ON adgroup_metrics_daily (account_id, date);
    CREATE INDEX IF NOT EXISTS idx_amd_account_campaign ON adgroup_metrics_daily (account_id, campaign_id, date);

    -- Campaign metadata snapshot (name/state/budget) — refreshed alongside metrics.
    -- format: 'STANDARD' (default) or 'VIDEO' — only meaningful for SB campaigns;
    -- lets the optimizer treat SB-Video as its own program for target-ACOS lookups.
    CREATE TABLE IF NOT EXISTS campaign_meta (
      account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      campaign_id    TEXT NOT NULL,
      program        TEXT NOT NULL,
      name           TEXT,
      state          TEXT,
      daily_budget   REAL,
      portfolio_id   TEXT,
      targeting_type TEXT,
      brand_entity_id TEXT,
      format         TEXT NOT NULL DEFAULT 'STANDARD',
      updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (account_id, campaign_id)
    );

    -- ─── ACOS target matrix ──────────────────────────────────────────────
    -- One target per (program, intent) cell. '*' = "any" sentinel (SQLite
    -- NULLs in PKs are distinct, so we use a string sentinel instead).
    -- Lookup precedence:
    --   1. exact (program, intent)
    --   2. (program, '*')
    --   3. ('*', intent)
    --   4. ('*', '*')  ← account default
    -- Stored as percentage (25 = 25% ACOS).
    CREATE TABLE IF NOT EXISTS acos_targets (
      account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      program      TEXT NOT NULL,        -- 'SP' | 'SB' | 'SB_VIDEO' | 'SD' | '*'
      intent       TEXT NOT NULL,        -- 'BRANDED' | 'GENERIC' | 'COMPETITION' | 'AUTO' | 'PAT' | 'OTHER' | '*'
      target_acos  REAL NOT NULL,        -- percent (e.g. 25)
      updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (account_id, program, intent)
    );

    CREATE TABLE IF NOT EXISTS adgroup_meta (
      account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      adgroup_id   TEXT NOT NULL,
      campaign_id  TEXT NOT NULL,
      program      TEXT NOT NULL,
      name         TEXT,
      state        TEXT,
      default_bid  REAL,
      updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (account_id, adgroup_id)
    );

    -- Tracks when each account/level was last refreshed.
    CREATE TABLE IF NOT EXISTS account_refresh_state (
      account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      level        TEXT NOT NULL,        -- 'campaigns' | 'adgroups' | 'targeting'
      last_refresh_at TEXT NOT NULL,
      window_start TEXT NOT NULL,
      window_end   TEXT NOT NULL,
      rows_upserted INTEGER NOT NULL DEFAULT 0,
      duration_ms  INTEGER,
      error        TEXT,
      PRIMARY KEY (account_id, level)
    );

    -- ─── Keyword / product-target daily metrics ──────────────────────────
    -- v3 spTargeting report rolls both into one stream identified by
    -- "keywordId" (despite the name). target_id here is that universal ID.
    CREATE TABLE IF NOT EXISTS targeting_metrics_daily (
      account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      campaign_id  TEXT NOT NULL,
      adgroup_id   TEXT NOT NULL,
      target_id    TEXT NOT NULL,
      date         TEXT NOT NULL,
      program      TEXT NOT NULL,        -- only 'SP' wired today
      kind         TEXT,                 -- 'KEYWORD' | 'PRODUCT_TARGET' | 'AUTO'
      match_type   TEXT,                 -- EXACT/PHRASE/BROAD or null
      display      TEXT,                 -- keyword text or ASIN expression
      impressions  INTEGER NOT NULL DEFAULT 0,
      clicks       INTEGER NOT NULL DEFAULT 0,
      cost         REAL    NOT NULL DEFAULT 0,
      orders       INTEGER NOT NULL DEFAULT 0,
      sales        REAL    NOT NULL DEFAULT 0,
      updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (account_id, target_id, date)
    );
    CREATE INDEX IF NOT EXISTS idx_tmd_account_date     ON targeting_metrics_daily (account_id, date);
    CREATE INDEX IF NOT EXISTS idx_tmd_account_adgroup  ON targeting_metrics_daily (account_id, adgroup_id);
    CREATE INDEX IF NOT EXISTS idx_tmd_account_campaign ON targeting_metrics_daily (account_id, campaign_id);

    -- Targeting metadata (state + current bid).
    CREATE TABLE IF NOT EXISTS targeting_meta (
      account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      target_id    TEXT NOT NULL,
      campaign_id  TEXT NOT NULL,
      adgroup_id   TEXT NOT NULL,
      program      TEXT NOT NULL,
      kind         TEXT NOT NULL,        -- 'KEYWORD' | 'PRODUCT_TARGET'
      display      TEXT,
      match_type   TEXT,                 -- EXACT/PHRASE/BROAD or null
      state        TEXT,                 -- ENABLED/PAUSED/ARCHIVED
      bid          REAL,
      updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (account_id, target_id)
    );
    CREATE INDEX IF NOT EXISTS idx_tm_account_adgroup ON targeting_meta (account_id, adgroup_id);
  `);

  // ─── Non-destructive column adds for existing prod DBs ──────────────────
  // CREATE TABLE IF NOT EXISTS doesn't add columns to existing tables, so
  // walk the schema and add any missing pieces using ALTER TABLE.
  addColumnIfMissing(db, "objectives",            "target_roas",                  "REAL");
  addColumnIfMissing(db, "objectives",            "max_scale_up_pct",             "REAL DEFAULT 20");
  addColumnIfMissing(db, "objectives",            "max_scale_down_pct",           "REAL DEFAULT 30");
  addColumnIfMissing(db, "objectives",            "min_spend_threshold",          "REAL DEFAULT 100");
  addColumnIfMissing(db, "objectives",            "pause_when_orders_zero_days",  "INTEGER DEFAULT 7");
  addColumnIfMissing(db, "suggestions",           "bucket",                       "TEXT");
  addColumnIfMissing(db, "suggestions",           "signals_json",                 "TEXT");
  addColumnIfMissing(db, "suggestions",           "override_value",               "REAL");
  addColumnIfMissing(db, "suggestions",           "reviewer",                     "TEXT");
  addColumnIfMissing(db, "suggestions",           "decision_note",                "TEXT");
  addColumnIfMissing(db, "suggestions",           "confidence",                   "REAL");
  addColumnIfMissing(db, "campaign_metrics_daily","top_of_search_is",             "REAL");
  addColumnIfMissing(db, "campaign_meta",          "format",                       "TEXT NOT NULL DEFAULT 'STANDARD'");
}

interface ColumnInfo { name: string }
function addColumnIfMissing(db: Database.Database, table: string, column: string, decl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[];
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
}
