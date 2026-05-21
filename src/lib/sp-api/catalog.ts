/**
 * SP-API Catalog Items API — look up product title + brand by ASIN.
 * Docs: https://developer-docs.amazon.com/sp-api/docs/catalog-items-api-v2022-04-01-reference
 */
import { spRequest, getSpSellerId } from "./client";
import { accountSpRequest } from "../amazon-api/account-client";
import { cacheGet, cacheSet } from "../cache";

interface CatalogItem {
  asin: string;
  summaries?: {
    marketplaceId: string;
    brand?: string;        // actual field name returned by Amazon
    brandName?: string;    // some marketplaces return this instead — accept both
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
  // Explicit pageSize: Amazon's default for this endpoint silently caps the
  // response at 10 even when 20 identifiers are passed, leaving the other
  // 10 with "no catalog data". Set pageSize to batch length so every
  // requested ASIN comes back.
  const path = `/catalog/2022-04-01/items?identifiers=${encodeURIComponent(identifiers)}&identifiersType=ASIN&marketplaceIds=${marketplaceId}&includedData=summaries&pageSize=${asins.length}`;

  const res = await spReq<CatalogResponse>(accountId, path);
  for (const item of res.items ?? []) {
    const summary = item.summaries?.[0];
    const title = summary?.itemName ?? "";
    // Read both possible field names; Indian marketplace returns `brand`.
    const brand = summary?.brand ?? summary?.brandName ?? inferBrand(title);
    result.set(item.asin, { title, brand });
  }
  return result;
}

/**
 * SKU-keyed variant of fetchCatalogBatch. Catalog Items API accepts
 * identifiersType=SKU; the response items still come back with `.asin`
 * so the caller can map SKU → ASIN if needed.
 */
async function fetchCatalogBySkuBatch(
  skus: string[],
  marketplaceId: string,
  sellerId: string,
): Promise<Map<string, AsinInfo & { asin: string }>> {
  const result = new Map<string, AsinInfo & { asin: string }>();
  if (!skus.length) return result;
  const identifiers = skus.join(",");
  // sellerId is REQUIRED for SKU-based searches per Catalog Items API spec.
  // includedData=identifiers lets us match response items back to input SKUs
  // by reading each item.identifiers[].identifiers[].identifier (== SKU).
  const path = `/catalog/2022-04-01/items?identifiers=${encodeURIComponent(identifiers)}&identifiersType=SKU&marketplaceIds=${marketplaceId}&sellerId=${encodeURIComponent(sellerId)}&includedData=summaries,identifiers&pageSize=${skus.length}`;

  interface CatalogItemIdentifiers {
    marketplaceId: string;
    identifiers: Array<{ identifier: string; identifierType: string }>;
  }
  interface CatalogItemWithAsin extends CatalogItem { asin: string; identifiers?: CatalogItemIdentifiers[] }
  const res = await spRequest<{ items: CatalogItemWithAsin[] }>(path);

  for (const item of res.items ?? []) {
    const summary = item.summaries?.[0];
    const title = summary?.itemName ?? "";
    const brand = summary?.brand ?? summary?.brandName ?? inferBrand(title);
    // Find every SKU identifier on this item and emit a row for each.
    // Items in the response often include both ASIN and SKU identifiers;
    // we only want to key the result by SKU.
    const skuIds = item.identifiers
      ?.flatMap((g) => g.identifiers ?? [])
      .filter((id) => id.identifierType === "SKU")
      .map((id) => id.identifier) ?? [];
    if (skuIds.length === 0) continue;
    for (const sku of skuIds) {
      result.set(sku, { title, brand, asin: item.asin });
    }
  }
  return result;
}

/** SKU-keyed catalog lookup with cache + per-batch retry on rate limit. */
export async function lookupSkus(skus: string[], marketplaceId: string): Promise<Map<string, AsinInfo & { asin: string }>> {
  const result = new Map<string, AsinInfo & { asin: string }>();
  const uncached: string[] = [];
  for (const sku of skus) {
    const hit = cacheGet<AsinInfo & { asin: string }>(`sku:${sku}`);
    if (hit) result.set(sku, hit);
    else uncached.push(sku);
  }
  if (!uncached.length) return result;

  const sellerId = await getSpSellerId();

  for (let i = 0; i < uncached.length; i += 20) {
    const batch = uncached.slice(i, i + 20);
    let attempt = 0;
    let batchResult: Map<string, AsinInfo & { asin: string }> = new Map();
    while (attempt < 4) {
      try { batchResult = await fetchCatalogBySkuBatch(batch, marketplaceId, sellerId); break; }
      catch (e) {
        const msg = String(e);
        if (/429|rate limit/i.test(msg) && attempt < 3) {
          await new Promise((r) => setTimeout(r, 1500 * Math.pow(2, attempt)));
          attempt++; continue;
        }
        throw e;
      }
    }
    for (const [sku, info] of batchResult) {
      result.set(sku, info);
      cacheSet(`sku:${sku}`, info, 86_400_000);
    }
    if (i + 20 < uncached.length) await new Promise((r) => setTimeout(r, 600));
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

  // Fetch in batches of 20 (SP-API limit). Catalog Items API documented
  // rate limit is 2 req/sec — wait 600ms between batches to stay under.
  // Per-batch retry on 429 with exponential backoff.
  for (let i = 0; i < uncached.length; i += 20) {
    const batch = uncached.slice(i, i + 20);
    let attempt = 0;
    let batchResult: Map<string, AsinInfo> = new Map();
    while (attempt < 4) {
      try {
        batchResult = await fetchCatalogBatch(batch, marketplaceId, accountId);
        break;
      } catch (err) {
        const msg = String(err);
        if (/429|rate limit/i.test(msg) && attempt < 3) {
          const backoffMs = 1500 * Math.pow(2, attempt);
          console.warn(`[catalog] 429 — backing off ${backoffMs}ms (attempt ${attempt + 1})`);
          await new Promise((r) => setTimeout(r, backoffMs));
          attempt++;
          continue;
        }
        throw err;
      }
    }
    for (const [asin, info] of batchResult) {
      result.set(asin, info);
      cacheSet(`asin:${asin}`, info, 86_400_000); // 24h cache
    }
    // Defensive: if Amazon's batch response is missing any ASIN we asked
    // for (we've seen this happen even with pageSize set), retry those
    // individually. Slower path but means we don't leave revenue unmapped.
    const missing = batch.filter((a) => !batchResult.has(a));
    for (const asin of missing) {
      await new Promise((r) => setTimeout(r, 600));
      try {
        const one = await fetchCatalogBatch([asin], marketplaceId, accountId);
        for (const [a, info] of one) {
          result.set(a, info);
          cacheSet(`asin:${a}`, info, 86_400_000);
        }
      } catch (e) {
        console.warn(`[catalog] per-ASIN retry failed for ${asin}: ${String(e).slice(0, 80)}`);
      }
    }
    if (i + 20 < uncached.length) {
      await new Promise((r) => setTimeout(r, 600));
    }
  }

  return result;
}
