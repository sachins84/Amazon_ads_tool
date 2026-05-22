/**
 * Brand-split seller fees — combines /finances/v0/financialEvents per-SKU
 * aggregates with Catalog API SKU→brand lookups to produce per-brand
 * commission + logistics totals.
 *
 * Used by /api/pnl to replace the configured commission_pct and
 * logistics_pct factors with actuals from settlements where available.
 */
import { fetchSellerFeeAggregates, type PerSkuFees } from "./finances";
import { getSettlementFees } from "./settlement-report";
import { lookupAsins, lookupSkus } from "./catalog";
import { inferBrandFromTitle, type BrandKey } from "./brand-split-sales";
import { getSpMarketplaceId } from "./client";
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

/** Per-brand fee % of gross principal, derived from a mature settlement
 *  history window. Use these to project fees for any time window — the
 *  underlying source refreshes weekly (settlement reports don't change
 *  once posted, and Amazon emits them on a ~14-day cycle). */
export interface BrandFeeRates {
  byBrand: Record<BrandKey, BrandFeeRate>;
  diagnostics: {
    refWindow: { startDate: string; endDate: string };
    settledDays: number;
    totalGrossPrincipal: number;
    asinsSeen: number;
    asinsMatched: number;
    maturity: "low" | "medium" | "high";  // <7d=low, 7-21d=medium, ≥21d=high
  };
}
export interface BrandFeeRate {
  commissionPct: number;   // 0..1 — commission_amount / grossPrincipal
  logisticsPct: number;    // 0..1 — (fulfillment + storage) / grossPrincipal
  sampleGrossPrincipal: number;
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
  // Primary path: Settlement Reports — single CSV per cycle, no rate limit,
  // each row has ASIN so we use the existing ASIN→brand mapping (99.97% hit).
  const settlement = await getSettlementFees(startDate, endDate);

  const asins = [...settlement.byAsin.keys()].filter((a) => a && a !== "(unknown)");
  let asinInfo: Awaited<ReturnType<typeof lookupAsins>> = new Map();
  if (asins.length) {
    try {
      asinInfo = await lookupAsins(asins, marketplaceId);
    } catch (e) {
      console.warn(`[brand-fees] ASIN catalog lookup failed: ${String(e).slice(0, 120)}`);
    }
  }

  const byBrand: Record<BrandKey, BrandFeeBucket> = {
    manmatters: EMPTY_BUCKET(),
    bebodywise: EMPTY_BUCKET(),
    littlejoys: EMPTY_BUCKET(),
    other:      EMPTY_BUCKET(),
  };
  const unmappedSkus: BrandFeesResult["unmappedSkus"] = [];
  let matched = 0;

  for (const [asin, row] of settlement.byAsin) {
    const info = asinInfo.get(asin);
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
        sku: asin, commission: row.commission, fulfillment: row.fulfillment, storage: row.storage,
      });
    }
  }
  unmappedSkus.sort((a, b) => (b.commission + b.fulfillment + b.storage) - (a.commission + a.fulfillment + a.storage));

  return {
    byBrand,
    unmappedSkus: unmappedSkus.slice(0, 30),
    totals: {
      commission:  settlement.totals.commission,
      fulfillment: settlement.totals.fulfillment,
      storage:     settlement.totals.storage,
      refunds:     settlement.totals.refunds,
      skusSeen:    settlement.byAsin.size,
      skusMatched: matched,
    },
    truncated:    false,
    pagesFetched: settlement.reports.length,
  };
}

// Kept for back-compat / fallback consumers. Not used by the primary path.
export async function computeBrandFeesFromEvents(
  marketplaceId: string,
  startDate: string,
  endDate: string,
): Promise<BrandFeesResult> {
  const fees = await fetchSellerFeeAggregates(startDate, endDate);
  const skus = [...fees.bySku.keys()].filter((s) => s && s !== "(unknown_sku)");
  let skuInfo: Awaited<ReturnType<typeof lookupSkus>> = new Map();
  try { skuInfo = await lookupSkus(skus, marketplaceId); }
  catch (e) { console.warn(`[brand-fees] SKU catalog lookup failed: ${String(e).slice(0, 120)}`); }
  const byBrand: Record<BrandKey, BrandFeeBucket> = {
    manmatters: EMPTY_BUCKET(), bebodywise: EMPTY_BUCKET(),
    littlejoys: EMPTY_BUCKET(), other: EMPTY_BUCKET(),
  };
  let matched = 0;
  for (const [sku, row] of fees.bySku) {
    const info = skuInfo.get(sku);
    const fromBrandField = info?.brand ? inferBrandFromTitle(info.brand) : "other";
    const brand: BrandKey = fromBrandField !== "other"
      ? fromBrandField : inferBrandFromTitle(info?.title ?? "");
    const bucket = byBrand[brand];
    bucket.commission += row.commission; bucket.fulfillment += row.fulfillment;
    bucket.storage += row.storage; bucket.refunds += row.refunds; bucket.skuCount += 1;
    if (brand !== "other") matched++;
    void sku;
  }
  return {
    byBrand, unmappedSkus: [],
    totals: {
      commission: fees.commission, fulfillment: fees.fulfillment, storage: fees.storage,
      refunds: fees.refunds, skusSeen: fees.bySku.size, skusMatched: matched,
    },
    truncated: fees.truncated, pagesFetched: fees.pagesFetched,
  };
}

void getSpMarketplaceId; // silence linter if unused

// ─── Rate-based projection ────────────────────────────────────────────────────

const rateInflight = new Map<string, Promise<BrandFeeRates>>();

/** Pulls a 60-day mature-history window of settlement data and derives a
 *  per-brand fee % of gross principal. Cached for 7 days; same call site can
 *  use these rates to project commission + logistics for any P&L window
 *  without re-fetching settlements per request. */
export async function fetchBrandFeeRates(marketplaceId: string, refDaysBack = 60): Promise<BrandFeeRates> {
  // Reference window: last `refDaysBack` days ending today. We don't trim to
  // "fully-settled only" — newer days that *are* in a settlement report still
  // contribute; days not yet settled simply add nothing.
  const end   = new Date();
  const start = new Date(); start.setDate(start.getDate() - refDaysBack);
  const fmt   = (d: Date) => d.toISOString().split("T")[0];
  const refStart = fmt(start), refEnd = fmt(end);
  const key = `brand-fee-rates:${marketplaceId}:${refStart}:${refEnd}`;
  const existing = rateInflight.get(key);
  if (existing) return existing;

  const p = withCache(key, () => computeBrandFeeRates(marketplaceId, refStart, refEnd), 7 * 24 * 60 * 60 * 1000)
    .finally(() => rateInflight.delete(key));
  rateInflight.set(key, p);
  return p;
}

async function computeBrandFeeRates(
  marketplaceId: string,
  refStart: string,
  refEnd: string,
): Promise<BrandFeeRates> {
  const settlement = await getSettlementFees(refStart, refEnd);
  const asins = [...settlement.byAsin.keys()].filter((a) => a && a !== "(unknown)");
  let asinInfo: Awaited<ReturnType<typeof lookupAsins>> = new Map();
  if (asins.length) {
    try { asinInfo = await lookupAsins(asins, marketplaceId); }
    catch (e) { console.warn(`[brand-fees] ref ASIN lookup failed: ${String(e).slice(0, 120)}`); }
  }

  interface Accum { commission: number; logistics: number; gross: number }
  const acc: Record<BrandKey, Accum> = {
    manmatters: { commission: 0, logistics: 0, gross: 0 },
    bebodywise: { commission: 0, logistics: 0, gross: 0 },
    littlejoys: { commission: 0, logistics: 0, gross: 0 },
    other:      { commission: 0, logistics: 0, gross: 0 },
  };
  let matched = 0;
  for (const [asin, row] of settlement.byAsin) {
    const info = asinInfo.get(asin);
    const fromBrand = info?.brand ? inferBrandFromTitle(info.brand) : "other";
    const brand: BrandKey = fromBrand !== "other" ? fromBrand : inferBrandFromTitle(info?.title ?? "");
    acc[brand].commission += row.commission;
    acc[brand].logistics  += row.fulfillment + row.storage;
    acc[brand].gross      += Math.max(row.grossPrincipal, 0);
    if (brand !== "other") matched++;
  }

  const byBrand: Record<BrandKey, BrandFeeRate> = {
    manmatters: rateFromAccum(acc.manmatters),
    bebodywise: rateFromAccum(acc.bebodywise),
    littlejoys: rateFromAccum(acc.littlejoys),
    other:      rateFromAccum(acc.other),
  };

  const settledDays = settlement.settledDates.length;
  const maturity: "low" | "medium" | "high" =
    settledDays >= 21 ? "high" : settledDays >= 7 ? "medium" : "low";

  return {
    byBrand,
    diagnostics: {
      refWindow: { startDate: refStart, endDate: refEnd },
      settledDays,
      totalGrossPrincipal: settlement.totals.grossPrincipal,
      asinsSeen: settlement.byAsin.size,
      asinsMatched: matched,
      maturity,
    },
  };
}

function rateFromAccum(a: { commission: number; logistics: number; gross: number }): BrandFeeRate {
  if (a.gross <= 0) {
    return { commissionPct: 0, logisticsPct: 0, sampleGrossPrincipal: 0 };
  }
  return {
    commissionPct: a.commission / a.gross,
    logisticsPct:  a.logistics / a.gross,
    sampleGrossPrincipal: a.gross,
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
