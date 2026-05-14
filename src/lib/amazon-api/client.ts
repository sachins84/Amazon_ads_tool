/**
 * Base HTTP client for the Amazon Advertising API.
 * Handles auth headers, base URL, rate-limit retries, and error normalisation.
 */
import { getAccessToken, AmazonApiError } from "./token";
import { accountRequest } from "./account-client";

const BASE_URL = process.env.AMAZON_API_ENDPOINT ?? "https://advertising-api.amazon.com";

export interface AmazonRequestOptions {
  profileId?: string;
  /** When set, use DB-stored credentials for this account instead of env vars */
  accountId?: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  /** Max retries on 429 rate-limit responses */
  retries?: number;
  /** Extra/override headers (e.g. v3/v4 content-type per program) */
  headers?: Record<string, string>;
}

export async function amazonRequest<T>(
  path: string,
  opts: AmazonRequestOptions = {}
): Promise<T> {
  // Delegate to per-account client when accountId is provided
  if (opts.accountId) {
    return accountRequest<T>(opts.accountId, path, {
      method: opts.method,
      body: opts.body,
      retries: opts.retries,
      headers: opts.headers,
    });
  }

  const { method = "GET", body, retries = 3 } = opts;
  const profileId = opts.profileId ?? process.env.AMAZON_PROFILE_ID ?? "";

  const accessToken = await getAccessToken();

  const headers: Record<string, string> = {
    "Authorization": `Bearer ${accessToken}`,
    "Amazon-Advertising-API-ClientId": process.env.AMAZON_CLIENT_ID!,
    "Content-Type": "application/json",
  };

  if (profileId) headers["Amazon-Advertising-API-Scope"] = profileId;
  if (opts.headers) Object.assign(headers, opts.headers);

  const url = `${BASE_URL}${path}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    // Rate limited — exponential backoff
    if (res.status === 429) {
      if (attempt === retries) throw new AmazonApiError("Rate limit exceeded", 429);
      const waitMs = Math.pow(2, attempt) * 1000;
      await sleep(waitMs);
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new AmazonApiError(
        `Amazon API error ${res.status} on ${method} ${path}: ${text}`,
        res.status
      );
    }

    // 204 No Content
    if (res.status === 204) return {} as T;

    return res.json() as Promise<T>;
  }

  throw new AmazonApiError("Max retries exceeded", 429);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
