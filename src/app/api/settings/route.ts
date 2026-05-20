import { type NextRequest } from "next/server";
import { getSetting, setSetting, listSettingsSafe, type SettingKey } from "@/lib/db/settings-repo";
import { resetSpAccessTokenCache } from "@/lib/sp-api/client";

export const dynamic = "force-dynamic";

const ALLOWED_KEYS: SettingKey[] = [
  "sp_api.client_id",
  "sp_api.client_secret",
  "sp_api.refresh_token",
  "sp_api.marketplace_id",
  "sp_api.endpoint",
];

/**
 * GET /api/settings — returns a redacted view of all known settings.
 *   Secret values come back as { hasValue: true, value: null } so the UI
 *   can show "set" / "not set" without exposing the secret to the browser.
 *
 * PUT /api/settings — body is a partial map of { key: value, ... }.
 *   Values stored as-is (or encrypted, for secret keys). Empty strings or
 *   null values delete the setting and revert to env-var fallback.
 *
 * The SP-API access-token cache is reset whenever sp_api.* changes so the
 * next request re-fetches with the new credentials.
 */
export async function GET() {
  return Response.json({ settings: listSettingsSafe() });
}

export async function PUT(req: NextRequest) {
  const body = await req.json() as Record<string, string | null>;
  let touched_sp = false;
  for (const [key, value] of Object.entries(body)) {
    if (!ALLOWED_KEYS.includes(key as SettingKey)) continue;
    setSetting(key as SettingKey, value);
    if (key.startsWith("sp_api.")) touched_sp = true;
  }
  if (touched_sp) resetSpAccessTokenCache();
  return Response.json({ settings: listSettingsSafe() });
}

/**
 * POST /api/settings/test  — quick check that current SP creds work by
 * attempting a token refresh. Returns { ok: true } or the error message.
 * Useful to verify the user's pasted credentials before they wait 5 min
 * for a sales report to fail.
 */
export async function POST() {
  try {
    const { getSpAccessToken } = await import("@/lib/sp-api/client");
    await getSpAccessToken();
    const mp = getSetting("sp_api.marketplace_id") ?? process.env.SP_API_MARKETPLACE_ID ?? null;
    return Response.json({ ok: true, marketplaceId: mp });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 200 });
  }
}
