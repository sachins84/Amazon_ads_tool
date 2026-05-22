/**
 * Brand-split seller fees — combines /finances/v0/financialEvents per-SKU
 * aggregates with Catalog API SKU→brand lookups to produce per-brand
 * commission + logistics totals.
 *
 * Used by /api/pnl to replace the configured commission_pct and
 * logistics_pct factors with actuals from settlements where available.
 */
import { fetchSellerFeeAggregates, type PerSkuFees } from "./finances";
import { lookupSkus } from "./catalog";
import { inferBrandFromTitle, type BrandKey } from "./brand-split-sales";
import { withCache } from "@/lib/cache";

export interface BrandFeeBucket {
  commission: number;
  fulfillment: number;
  storage: number;
  refunds: number;
  skuCount: number;
}

export interface BrandFeesResult {
  byBrand: Record<BrandKey, BrandFeeBucket>;
  unmappedSkus: { sku: string; commission: number; fulfillment: number; storage: number }[];
  totals: {
    commission: number;
    fulfillment: number;
    storage: number;
    refunds: number;
    skusSeen: number;
    skusMatched: number;
  };
  truncated: boolean;
  pagesFetched: number;
}

const EMPTY_BUCKET = (): BrandFeeBucket => ({
  commission: 0, fulfillment: 0, storage: 0, refunds: 0, skuCount: 0,
});

const inflight = new Map<string, Promise<BrandFeesResult>>();

/** Cache key shape: marketplaceId:startDate:endDate. 10-min TTL — matches the
 *  underlying finances/catalog caches, so we don't re-walk SKUs unnecessarily. */
export async function fetchBrandFees(
  marketplaceId: string,
  startDate: string,
  endDate: string,
): Promise<BrandFeesResult> {
  const key = `brand-fees:${marketplaceId}:${startDate}:${endDate}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = withCache(key, () => computeBrandFees(marketplaceId, startDate, endDate), 10 * 60 * 1000)
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function computeBrandFees(
  marketplaceId: string,
  startDate: string,
  endDate: string,
): Promise<BrandFeesResult> {
  const fees = await fetchSellerFeeAggregates(startDate, endDate);
  const skus = [...fees.bySku.keys()].filter((s) => s && s !== "(unknown_sku)");

  // Catalog lookup; tolerate partial failure (returns subset of skus).
  let skuInfo: Awaited<ReturnType<typeof lookupSkus>> = new Map();
  try {
    skuInfo = await lookupSkus(skus, marketplaceId);
  } catch (e) {
    console.warn(`[brand-fees] SKU catalog lookup failed: ${String(e).slice(0, 120)}`);
  }

  const byBrand: Record<BrandKey, BrandFeeBucket> = {
    manmatters: EMPTY_BUCKET(),
    bebodywise: EMPTY_BUCKET(),
    littlejoys: EMPTY_BUCKET(),
    other:      EMPTY_BUCKET(),
  };
  const unmappedSkus: BrandFeesResult["unmappedSkus"] = [];
  let matched = 0;

  for (const [sku, row] of fees.bySku) {
    const info = skuInfo.get(sku);
    // Prefer Amazon's brand field; fall back to title regex when blank.
    const fromBrandField = info?.brand ? inferBrandFromTitle(info.brand) : "other";
    const brand: BrandKey = fromBrandField !== "other"
      ? fromBrandField
      : inferBrandFromTitle(info?.title ?? "");
    const bucket = byBrand[brand];
    bucket.commission  += row.commission;
    bucket.fulfillment += row.fulfillment;
    bucket.storage     += row.storage;
    bucket.refunds     += row.refunds;
    bucket.skuCount    += 1;
    if (brand !== "other") matched++;
    else if (row.commission + row.fulfillment + row.storage > 0) {
      unmappedSkus.push({
        sku, commission: row.commission, fulfillment: row.fulfillment, storage: row.storage,
      });
    }
  }

  unmappedSkus.sort((a, b) => (b.commission + b.fulfillment + b.storage) - (a.commission + a.fulfillment + a.storage));

  return {
    byBrand,
    unmappedSkus: unmappedSkus.slice(0, 30),
    totals: {
      commission:  fees.commission,
      fulfillment: fees.fulfillment,
      storage:     fees.storage,
      refunds:     fees.refunds,
      skusSeen:    fees.bySku.size,
      skusMatched: matched,
    },
    truncated:    fees.truncated,
    pagesFetched: fees.pagesFetched,
  };
}

export interface BrandFeeTotalsResult {
  data: { commission: number; logistics: number; refunds: number; skuCount: number } | null;
  reason: string;          // human-readable explanation when data is null
  diagnostics: {
    skusSeen: number;
    skusMatched: number;
    skusForBrand: number;
    totalEvents: number;
    truncated?: boolean;
    pagesFetched?: number;
    error?: string;
  };
}

/** Returns a single brand's actual fee totals, with a reason string when data
 *  is null so the UI can show *why* settlements weren't usable. */
export async function brandFeeTotals(
  marketplaceId: string,
  startDate: string,
  endDate: string,
  brand: BrandKey,
): Promise<BrandFeeTotalsResult> {
  let all: BrandFeesResult;
  try {
    all = await fetchBrandFees(marketplaceId, startDate, endDate);
  } catch (e) {
    const err = String(e).slice(0, 200);
    console.warn(`[brand-fees] failed: ${err}`);
    return {
      data: null,
      reason: `SP-API settlements call failed: ${err}`,
      diagnostics: { skusSeen: 0, skusMatched: 0, skusForBrand: 0, totalEvents: 0, error: err },
    };
  }
  const b = all.byBrand[brand];
  const diagnostics = {
    skusSeen:     all.totals.skusSeen,
    skusMatched:  all.totals.skusMatched,
    skusForBrand: b?.skuCount ?? 0,
    totalEvents:  all.totals.skusSeen > 0 ? 1 : 0,
    truncated:    all.truncated,
    pagesFetched: all.pagesFetched,
  };
  if (!b || b.skuCount === 0) {
    let reason: string;
    if (all.totals.skusSeen === 0) {
      reason = "No financial events found in window — Seller Central had no shipments/refunds for this period.";
    } else if (all.totals.skusMatched === 0) {
      reason = `Found ${all.totals.skusSeen} SKU(s) with fees, but Catalog lookup couldn't match any to known brands.`;
    } else {
      reason = `${all.totals.skusMatched} SKU(s) matched brands, but none belonged to "${brand}".`;
    }
    return { data: null, reason, diagnostics };
  }
  return {
    data: {
      commission: b.commission,
      logistics:  b.fulfillment + b.storage,
      refunds:    b.refunds,
      skuCount:   b.skuCount,
    },
    reason: "ok",
    diagnostics,
  };
}

// Re-export PerSkuFees for any caller that wants raw SKU rows.
export type { PerSkuFees };
