/**
 * Selling Partner API (SP-API) base client.
 * Uses the same LWA OAuth token endpoint as the Ads API but with a separate
 * refresh token scoped to selling partner access.
 *
 * Docs: https://developer-docs.amazon.com/sp-api/docs
 */

// ─── Token management ─────────────────────────────────────────────────────────

interface TokenCache { accessToken: string; expiresAt: number }
let cache: TokenCache | null = null;

export async function getSpAccessToken(): Promise<string> {
  const now = Date.now();
  if (cache && cache.expiresAt - 60_000 > now) return cache.accessToken;

  // DB settings (set via /accounts UI) take priority; .env.local is the
  // legacy fallback. Lazy-import settings-repo to keep this file usable
  // from contexts that haven't initialised the DB yet (rare, but the
  // ads-api client uses similar pattern).
  const { getSetting } = await import("@/lib/db/settings-repo");
  const clientId     = getSetting("sp_api.client_id")     || process.env.SP_API_CLIENT_ID     || process.env.AMAZON_CLIENT_ID;
  const clientSecret = getSetting("sp_api.client_secret") || process.env.SP_API_CLIENT_SECRET || process.env.AMAZON_CLIENT_SECRET;
  const refreshToken = getSetting("sp_api.refresh_token") || process.env.SP_API_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new SpConfigError(
      "Missing SP-API credentials. Set them on the /accounts page (SP-API setup section) or in .env.local"
    );
  }

  const res = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "refresh_token",
      client_id:     clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) throw new SpApiError(`SP-API token refresh failed (${res.status})`, res.status);

  const data = await res.json() as { access_token: string; expires_in: number };
  cache = { accessToken: data.access_token, expiresAt: now + data.expires_in * 1000 };
  return cache.accessToken;
}

// ─── Base request ─────────────────────────────────────────────────────────────

// Endpoint varies by region
const SP_ENDPOINTS: Record<string, string> = {
  NA: "https://sellingpartnerapi-na.amazon.com",
  EU: "https://sellingpartnerapi-eu.amazon.com",
  FE: "https://sellingpartnerapi-fe.amazon.com",
};

function getSpEndpoint(): string {
  // Same priority: settings table → env → NA default
  try {
    const { getSetting } = require("@/lib/db/settings-repo") as typeof import("@/lib/db/settings-repo");
    const s = getSetting("sp_api.endpoint");
    if (s) return s;
  } catch { /* DB not initialised */ }
  return process.env.SP_API_ENDPOINT ?? SP_ENDPOINTS.NA;
}

/** Resolves the marketplace ID used when /api/sales caller doesn't pass one. */
export function getSpMarketplaceId(): string | null {
  try {
    const { getSetting } = require("@/lib/db/settings-repo") as typeof import("@/lib/db/settings-repo");
    const s = getSetting("sp_api.marketplace_id");
    if (s) return s;
  } catch { /* DB not initialised */ }
  return process.env.SP_API_MARKETPLACE_ID ?? null;
}

/** Invalidates the in-memory token cache — call after credentials change. */
export function resetSpAccessTokenCache(): void {
  cache = null;
}

export async function spRequest<T>(
  path: string,
  opts: { method?: string; body?: unknown; params?: Record<string, string> } = {}
): Promise<T> {
  const { method = "GET", body, params } = opts;
  const accessToken = await getSpAccessToken();

  const url = new URL(`${getSpEndpoint()}${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), {
    method,
    headers: {
      "x-amz-access-token": accessToken,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 429) throw new SpApiError("SP-API rate limit exceeded", 429);

  if (!res.ok) {
    const text = await res.text();
    throw new SpApiError(`SP-API error ${res.status} on ${method} ${path}: ${text}`, res.status);
  }

  if (res.status === 204) return {} as T;
  return res.json() as Promise<T>;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class SpConfigError extends Error {
  constructor(msg: string) { super(msg); this.name = "SpConfigError"; }
}
export class SpApiError extends Error {
  status: number;
  constructor(msg: string, status: number) { super(msg); this.name = "SpApiError"; this.status = status; }
}
