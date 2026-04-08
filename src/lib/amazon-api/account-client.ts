/**
 * Per-account Amazon API client.
 * Uses credentials stored in the DB for the given accountId,
 * with per-account token caching.
 */
import { getAccount, getCachedToken, setCachedToken } from "@/lib/db/accounts";
import { AmazonConfigError, AmazonApiError } from "./token";

// ─── Token management ─────────────────────────────────────────────────────────

export async function getAccountAccessToken(accountId: string): Promise<string> {
  const cached = getCachedToken(accountId, "ads");
  if (cached) return cached;

  const account = getAccount(accountId);
  if (!account) throw new AmazonConfigError(`Account ${accountId} not found`);

  const res = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "refresh_token",
      client_id:     account.adsClientId,
      client_secret: account.adsClientSecret,
      refresh_token: account.adsRefreshToken,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new AmazonApiError(`Token refresh failed for account ${accountId}: ${body}`, res.status);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  setCachedToken(accountId, "ads", data.access_token, data.expires_in);
  return data.access_token;
}

export async function getAccountSpToken(accountId: string): Promise<string> {
  const cached = getCachedToken(accountId, "sp");
  if (cached) return cached;

  const account = getAccount(accountId);
  if (!account?.spRefreshToken) {
    throw new AmazonConfigError(`Account ${accountId} has no SP-API refresh token configured`);
  }

  const res = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "refresh_token",
      client_id:     account.adsClientId,
      client_secret: account.adsClientSecret,
      refresh_token: account.spRefreshToken,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new AmazonApiError(`SP token refresh failed for account ${accountId}: ${body}`, res.status);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  setCachedToken(accountId, "sp", data.access_token, data.expires_in);
  return data.access_token;
}

// ─── Request helper ───────────────────────────────────────────────────────────

export async function accountRequest<T>(
  accountId: string,
  path: string,
  opts: { method?: string; body?: unknown; retries?: number } = {}
): Promise<T> {
  const { method = "GET", body, retries = 3 } = opts;
  const account = getAccount(accountId);
  if (!account) throw new AmazonConfigError(`Account ${accountId} not found`);

  for (let attempt = 0; attempt <= retries; attempt++) {
    const accessToken = await getAccountAccessToken(accountId);

    const res = await fetch(`${account.adsEndpoint}${path}`, {
      method,
      headers: {
        "Authorization":                        `Bearer ${accessToken}`,
        "Amazon-Advertising-API-ClientId":      account.adsClientId,
        "Amazon-Advertising-API-Scope":         account.adsProfileId,
        "Content-Type":                         "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 429) {
      if (attempt === retries) throw new AmazonApiError("Rate limit exceeded", 429);
      await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new AmazonApiError(`Amazon API ${res.status} on ${method} ${path}: ${text}`, res.status);
    }

    if (res.status === 204) return {} as T;
    return res.json() as Promise<T>;
  }

  throw new AmazonApiError("Max retries exceeded", 429);
}

// ─── SP-API request helper ────────────────────────────────────────────────────

export async function accountSpRequest<T>(
  accountId: string,
  path: string,
  opts: { method?: string; body?: unknown; params?: Record<string, string> } = {}
): Promise<T> {
  const { method = "GET", body, params } = opts;
  const account = getAccount(accountId);
  if (!account) throw new AmazonConfigError(`Account ${accountId} not found`);

  const accessToken = await getAccountSpToken(accountId);
  const url = new URL(`${account.spEndpoint ?? "https://sellingpartnerapi-na.amazon.com"}${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), {
    method,
    headers: { "x-amz-access-token": accessToken, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new AmazonApiError(`SP-API ${res.status} on ${method} ${path}: ${text}`, res.status);
  }

  if (res.status === 204) return {} as T;
  return res.json() as Promise<T>;
}
