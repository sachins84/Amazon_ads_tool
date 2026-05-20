/**
 * Key/value store for app-wide settings — primarily SP-API app credentials
 * that need to be configurable via the dashboard so prod doesn't have to
 * rely on `.env.local`. Secrets are AES-256-GCM encrypted at rest using the
 * same crypto helper as account tokens.
 *
 * Convention: keys are dot-separated namespaces, e.g. "sp_api.client_id",
 * "sp_api.client_secret", "sp_api.refresh_token", "sp_api.marketplace_id",
 * "sp_api.endpoint". Anything with `secret` semantics gets encrypted=1.
 */
import { getDb } from "./index";
import { encrypt, decrypt } from "./crypto";

export type SettingKey =
  | "sp_api.client_id"
  | "sp_api.client_secret"
  | "sp_api.refresh_token"
  | "sp_api.marketplace_id"
  | "sp_api.endpoint";

/** Which keys are secrets — values are encrypted at rest. */
const SECRET_KEYS: ReadonlySet<SettingKey> = new Set([
  "sp_api.client_secret",
  "sp_api.refresh_token",
]);

interface Row { key: string; value: string; encrypted: number }

export function getSetting(key: SettingKey): string | null {
  const row = getDb()
    .prepare("SELECT key, value, encrypted FROM app_settings WHERE key = ?")
    .get(key) as Row | undefined;
  if (!row) return null;
  return row.encrypted === 1 ? decrypt(row.value) : row.value;
}

export function setSetting(key: SettingKey, value: string | null): void {
  if (value == null || value === "") {
    getDb().prepare("DELETE FROM app_settings WHERE key = ?").run(key);
    return;
  }
  const isSecret = SECRET_KEYS.has(key);
  const stored = isSecret ? encrypt(value) : value;
  getDb().prepare(`
    INSERT INTO app_settings (key, value, encrypted, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      encrypted = excluded.encrypted,
      updated_at = excluded.updated_at
  `).run(key, stored, isSecret ? 1 : 0);
}

/**
 * Returns a redacted view of all known settings — for the UI to render.
 * Secrets show "set" / "not set" only; non-secrets show their actual value.
 */
export function listSettingsSafe(): Record<string, { hasValue: boolean; value: string | null }> {
  const rows = getDb()
    .prepare("SELECT key, value, encrypted FROM app_settings")
    .all() as Row[];
  const map = new Map(rows.map((r) => [r.key, r]));
  const out: Record<string, { hasValue: boolean; value: string | null }> = {};
  const allKeys: SettingKey[] = [
    "sp_api.client_id", "sp_api.client_secret", "sp_api.refresh_token",
    "sp_api.marketplace_id", "sp_api.endpoint",
  ];
  for (const k of allKeys) {
    const row = map.get(k);
    if (!row) { out[k] = { hasValue: false, value: null }; continue; }
    if (SECRET_KEYS.has(k as SettingKey)) {
      out[k] = { hasValue: true, value: null };
    } else {
      out[k] = { hasValue: true, value: row.value };
    }
  }
  return out;
}
