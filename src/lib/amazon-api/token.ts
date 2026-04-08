/**
 * Amazon LWA (Login with Amazon) token manager.
 * Access tokens expire every 3600s — this module auto-refreshes them.
 */

interface TokenCache {
  accessToken: string;
  expiresAt: number; // unix ms
}

let cache: TokenCache | null = null;

export async function getAccessToken(): Promise<string> {
  const now = Date.now();

  // Return cached token if still valid (with 60s buffer)
  if (cache && cache.expiresAt - 60_000 > now) {
    return cache.accessToken;
  }

  const clientId     = process.env.AMAZON_CLIENT_ID;
  const clientSecret = process.env.AMAZON_CLIENT_SECRET;
  const refreshToken = process.env.AMAZON_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new AmazonConfigError(
      "Missing Amazon API credentials. Set AMAZON_CLIENT_ID, AMAZON_CLIENT_SECRET, and AMAZON_REFRESH_TOKEN in .env.local"
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

  if (!res.ok) {
    const body = await res.text();
    throw new AmazonApiError(`Token refresh failed (${res.status}): ${body}`, res.status);
  }

  const data = await res.json() as { access_token: string; expires_in: number };

  cache = {
    accessToken: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };

  return cache.accessToken;
}

export class AmazonConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmazonConfigError";
  }
}

export class AmazonApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AmazonApiError";
    this.status = status;
  }
}
