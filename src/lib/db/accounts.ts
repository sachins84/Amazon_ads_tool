/**
 * Account CRUD operations — the single source of truth for all connected brands.
 */
import { v4 as uuidv4 } from "uuid";
import { getDb } from "./index";
import { encrypt, decrypt } from "./crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Account {
  id:              string;
  name:            string;
  color:           string;
  // Ads API
  adsClientId:     string;
  adsClientSecret: string;   // decrypted
  adsRefreshToken: string;   // decrypted
  adsEndpoint:     string;
  adsProfileId:    string;
  adsMarketplace:  string;
  // SP-API (optional)
  spRefreshToken:  string | null; // decrypted
  spMarketplaceId: string | null;
  spEndpoint:      string | null;
  // Status
  connected:       boolean;
  lastSyncedAt:    string | null;
  createdAt:       string;
}

export interface AccountInput {
  name:            string;
  color?:          string;
  adsClientId:     string;
  adsClientSecret: string;
  adsRefreshToken: string;
  adsEndpoint?:    string;
  adsProfileId:    string;
  adsMarketplace?: string;
  spRefreshToken?:  string | null;
  spMarketplaceId?: string | null;
  spEndpoint?:      string | null;
}

// ─── Row mapper ───────────────────────────────────────────────────────────────

type DbRow = {
  id: string; name: string; color: string;
  ads_client_id: string; ads_client_secret: string; ads_refresh_token: string;
  ads_endpoint: string; ads_profile_id: string; ads_marketplace: string;
  sp_refresh_token: string | null; sp_marketplace_id: string | null; sp_endpoint: string | null;
  connected: number; last_synced_at: string | null; created_at: string;
};

function rowToAccount(row: DbRow): Account {
  return {
    id:              row.id,
    name:            row.name,
    color:           row.color,
    adsClientId:     row.ads_client_id,
    adsClientSecret: decrypt(row.ads_client_secret),
    adsRefreshToken: decrypt(row.ads_refresh_token),
    adsEndpoint:     row.ads_endpoint,
    adsProfileId:    row.ads_profile_id,
    adsMarketplace:  row.ads_marketplace,
    spRefreshToken:  row.sp_refresh_token  ? decrypt(row.sp_refresh_token)  : null,
    spMarketplaceId: row.sp_marketplace_id ?? null,
    spEndpoint:      row.sp_endpoint       ?? null,
    connected:       row.connected === 1,
    lastSyncedAt:    row.last_synced_at,
    createdAt:       row.created_at,
  };
}

// ─── Safe public shape (no secrets) ──────────────────────────────────────────

export type SafeAccount = Omit<Account, "adsClientSecret" | "adsRefreshToken" | "spRefreshToken">;

export function toSafe(a: Account): SafeAccount {
  const { adsClientSecret: _s, adsRefreshToken: _r, spRefreshToken: _sp, ...safe } = a;
  return safe;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export function listAccounts(): SafeAccount[] {
  const db   = getDb();
  const rows = db.prepare("SELECT * FROM accounts ORDER BY created_at ASC").all() as DbRow[];
  return rows.map((r) => toSafe(rowToAccount(r)));
}

export function getAccount(id: string): Account | null {
  const db  = getDb();
  const row = db.prepare("SELECT * FROM accounts WHERE id = ?").get(id) as DbRow | undefined;
  return row ? rowToAccount(row) : null;
}

export function createAccount(input: AccountInput): SafeAccount {
  const db = getDb();
  const id = uuidv4();

  db.prepare(`
    INSERT INTO accounts (
      id, name, color,
      ads_client_id, ads_client_secret, ads_refresh_token,
      ads_endpoint, ads_profile_id, ads_marketplace,
      sp_refresh_token, sp_marketplace_id, sp_endpoint
    ) VALUES (
      @id, @name, @color,
      @adsClientId, @adsClientSecret, @adsRefreshToken,
      @adsEndpoint, @adsProfileId, @adsMarketplace,
      @spRefreshToken, @spMarketplaceId, @spEndpoint
    )
  `).run({
    id,
    name:           input.name,
    color:          input.color ?? "#6366f1",
    adsClientId:    input.adsClientId,
    adsClientSecret: encrypt(input.adsClientSecret),
    adsRefreshToken: encrypt(input.adsRefreshToken),
    adsEndpoint:    input.adsEndpoint    ?? "https://advertising-api.amazon.com",
    adsProfileId:   input.adsProfileId,
    adsMarketplace: input.adsMarketplace ?? "US",
    spRefreshToken:  input.spRefreshToken  ? encrypt(input.spRefreshToken) : null,
    spMarketplaceId: input.spMarketplaceId ?? null,
    spEndpoint:      input.spEndpoint      ?? null,
  });

  return toSafe(getAccount(id)!);
}

export function updateAccount(id: string, input: Partial<AccountInput>): SafeAccount | null {
  const db      = getDb();
  const existing = getAccount(id);
  if (!existing) return null;

  const fields: string[] = ["updated_at = datetime('now')"];
  const params: Record<string, unknown> = { id };

  if (input.name)            { fields.push("name = @name");                         params.name = input.name; }
  if (input.color)           { fields.push("color = @color");                       params.color = input.color; }
  if (input.adsClientId)     { fields.push("ads_client_id = @adsClientId");         params.adsClientId = input.adsClientId; }
  if (input.adsClientSecret) { fields.push("ads_client_secret = @adsClientSecret"); params.adsClientSecret = encrypt(input.adsClientSecret); }
  if (input.adsRefreshToken) { fields.push("ads_refresh_token = @adsRefreshToken"); params.adsRefreshToken = encrypt(input.adsRefreshToken); }
  if (input.adsEndpoint)     { fields.push("ads_endpoint = @adsEndpoint");          params.adsEndpoint = input.adsEndpoint; }
  if (input.adsProfileId)    { fields.push("ads_profile_id = @adsProfileId");       params.adsProfileId = input.adsProfileId; }
  if (input.adsMarketplace)  { fields.push("ads_marketplace = @adsMarketplace");    params.adsMarketplace = input.adsMarketplace; }
  if (input.spRefreshToken  !== undefined) { fields.push("sp_refresh_token = @spRefreshToken");   params.spRefreshToken  = input.spRefreshToken ? encrypt(input.spRefreshToken) : null; }
  if (input.spMarketplaceId !== undefined) { fields.push("sp_marketplace_id = @spMarketplaceId"); params.spMarketplaceId = input.spMarketplaceId; }

  db.prepare(`UPDATE accounts SET ${fields.join(", ")} WHERE id = @id`).run(params);
  return toSafe(getAccount(id)!);
}

export function deleteAccount(id: string): boolean {
  const db     = getDb();
  const result = db.prepare("DELETE FROM accounts WHERE id = ?").run(id);
  return result.changes > 0;
}

export function setAccountConnected(id: string, connected: boolean): void {
  getDb()
    .prepare("UPDATE accounts SET connected = ?, last_synced_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
    .run(connected ? 1 : 0, id);
}

// ─── Per-account token cache (replaces the in-memory cache in token.ts) ──────

export function getCachedToken(accountId: string, tokenType: "ads" | "sp"): string | null {
  const row = getDb()
    .prepare("SELECT access_token, expires_at FROM account_tokens WHERE account_id = ? AND token_type = ?")
    .get(accountId, tokenType) as { access_token: string; expires_at: number } | undefined;

  if (!row) return null;
  if (row.expires_at - 60_000 < Date.now()) return null; // expired
  return decrypt(row.access_token);
}

export function setCachedToken(accountId: string, tokenType: "ads" | "sp", accessToken: string, expiresIn: number): void {
  getDb().prepare(`
    INSERT INTO account_tokens (account_id, token_type, access_token, expires_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(account_id, token_type) DO UPDATE SET
      access_token = excluded.access_token,
      expires_at   = excluded.expires_at
  `).run(accountId, tokenType, encrypt(accessToken), Date.now() + expiresIn * 1000);
}
