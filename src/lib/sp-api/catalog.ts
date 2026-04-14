/**
 * SP-API Catalog Items API — look up product title + brand by ASIN.
 * Docs: https://developer-docs.amazon.com/sp-api/docs/catalog-items-api-v2022-04-01-reference
 */
import { spRequest } from "./client";
import { accountSpRequest } from "../amazon-api/account-client";
import { cacheGet, cacheSet } from "../cache";

interface CatalogItem {
  asin: string;
  summaries?: {
    marketplaceId: string;
    brandName?: string;
    itemName?: string;
  }[];
}

interface CatalogResponse {
  items: CatalogItem[];
}

export interface AsinInfo {
  title: string;
  brand: string;
}

/** Known brand prefixes — extract brand from product title when SP-API doesn't return brandName */
const KNOWN_BRANDS = [
  "Man Matters",
  "Be Bodywise",
  "Little Joys",
  "Bodywise",
];

function inferBrand(title: string): string {
  const lower = title.toLowerCase();
  for (const brand of KNOWN_BRANDS) {
    if (lower.startsWith(brand.toLowerCase())) return brand;
  }
  return "";
}

async function spReq<T>(
  accountId: string | undefined,
  path: string,
  opts?: { method?: string; body?: unknown; params?: Record<string, string> }
): Promise<T> {
  if (accountId) return accountSpRequest<T>(accountId, path, opts);
  return spRequest<T>(path, opts);
}

/**
 * Look up product titles and brand names for a batch of ASINs.
 * SP-API supports up to 20 ASINs per request.
 */
async function fetchCatalogBatch(
  asins: string[],
  marketplaceId: string,
  accountId?: string
): Promise<Map<string, AsinInfo>> {
  const result = new Map<string, AsinInfo>();
  if (!asins.length) return result;

  const identifiers = asins.join(",");
  const path = `/catalog/2022-04-01/items?identifiers=${encodeURIComponent(identifiers)}&identifiersType=ASIN&marketplaceIds=${marketplaceId}&includedData=summaries`;

  try {
    const res = await spReq<CatalogResponse>(accountId, path);
    if (res.items?.[0]) {
      console.log("[catalog] Sample item keys:", JSON.stringify(res.items[0]).slice(0, 500));
    }
    for (const item of res.items ?? []) {
      const summary = item.summaries?.[0];
      const title = summary?.itemName ?? "";
      const brand = summary?.brandName ?? inferBrand(title);
      result.set(item.asin, { title, brand });
    }
  } catch (err) {
    console.error("[catalog] Error fetching ASIN info:", err);
  }

  return result;
}

/**
 * Enrich a list of ASINs with product titles and brand names.
 * Results are cached for 24 hours.
 */
export async function lookupAsins(
  asins: string[],
  marketplaceId: string,
  accountId?: string
): Promise<Map<string, AsinInfo>> {
  const result = new Map<string, AsinInfo>();
  const uncached: string[] = [];

  // Check cache first
  for (const asin of asins) {
    const cached = cacheGet<AsinInfo>(`asin:${asin}`);
    if (cached) {
      result.set(asin, cached);
    } else {
      uncached.push(asin);
    }
  }

  if (!uncached.length) return result;

  // Fetch in batches of 20 (SP-API limit)
  for (let i = 0; i < uncached.length; i += 20) {
    const batch = uncached.slice(i, i + 20);
    const batchResult = await fetchCatalogBatch(batch, marketplaceId, accountId);
    for (const [asin, info] of batchResult) {
      result.set(asin, info);
      cacheSet(`asin:${asin}`, info, 86_400_000); // 24h cache
    }
    // Rate limit between batches
    if (i + 20 < uncached.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  return result;
}
