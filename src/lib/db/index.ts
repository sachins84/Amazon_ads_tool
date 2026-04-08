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
  `);
}
