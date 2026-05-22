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

void fetchSellerFeeAggregates; // legacy /finances API path — no longer used
void lookupSkus;               // SKU lookups not needed: settlement rows include ASIN
void EMPTY_BUCKET;             // kept for the BrandFeesResult type only
void getSpMarketplaceId;

// ─── Rate-based projection ────────────────────────────────────────────────────

const rateInflight = new Map<string, Promise<BrandFeeRates>>();

/** Pulls a 60-day mature-history window of settlement data and derives a
 *  per-brand fee % of gross principal. Cached for 7 days; same call site can
 *  use these rates to project commission + logistics for any P&L window
 *  without re-fetching settlements per request. */
export async function fetchBrandFeeRates(marketplaceId: string, refDaysBack = 30): Promise<BrandFeeRates> {
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
  // Read settled fee rollups from the DB (populated by the settlement-sync
  // background job). No SP-API call here — the doc-fetch quota (1/min) made
  // synchronous fetching untenable.
  const { loadSettlementFees, listSettledDates } = await import("@/lib/db/settlement-fees-store");
  const dailyRows = loadSettlementFees(marketplaceId, refStart, refEnd);

  // Roll up per-SKU so we can map SKU → brand via Catalog lookup.
  interface Accum { commission: number; logistics: number; gross: number }
  const bySku = new Map<string, Accum>();
  let totalGross = 0;
  for (const r of dailyRows) {
    if (!r.sku) continue;
    const cur = bySku.get(r.sku) ?? { commission: 0, logistics: 0, gross: 0 };
    cur.commission += r.commission;
    cur.logistics  += r.fulfillment + r.storage;
    cur.gross      += Math.max(r.grossPrincipal, 0);
    bySku.set(r.sku, cur);
    totalGross += Math.max(r.grossPrincipal, 0);
  }

  const skus = [...bySku.keys()];
  let skuInfo: Awaited<ReturnType<typeof lookupSkus>> = new Map();
  if (skus.length) {
    try { skuInfo = await lookupSkus(skus, marketplaceId); }
    catch (e) { console.warn(`[brand-fees] ref SKU lookup failed: ${String(e).slice(0, 120)}`); }
  }

  const acc: Record<BrandKey, Accum> = {
    manmatters: { commission: 0, logistics: 0, gross: 0 },
    bebodywise: { commission: 0, logistics: 0, gross: 0 },
    littlejoys: { commission: 0, logistics: 0, gross: 0 },
    other:      { commission: 0, logistics: 0, gross: 0 },
  };
  let matched = 0;
  for (const [sku, row] of bySku) {
    const info = skuInfo.get(sku);
    const fromBrand = info?.brand ? inferBrandFromTitle(info.brand) : "other";
    const brand: BrandKey = fromBrand !== "other" ? fromBrand : inferBrandFromTitle(info?.title ?? "");
    acc[brand].commission += row.commission;
    acc[brand].logistics  += row.logistics;
    acc[brand].gross      += row.gross;
    if (brand !== "other") matched++;
    void sku;
  }

  const byBrand: Record<BrandKey, BrandFeeRate> = {
    manmatters: rateFromAccum(acc.manmatters),
    bebodywise: rateFromAccum(acc.bebodywise),
    littlejoys: rateFromAccum(acc.littlejoys),
    other:      rateFromAccum(acc.other),
  };

  const settledDays = listSettledDates(marketplaceId, refStart, refEnd).length;
  const maturity: "low" | "medium" | "high" =
    settledDays >= 21 ? "high" : settledDays >= 7 ? "medium" : "low";

  return {
    byBrand,
    diagnostics: {
      refWindow: { startDate: refStart, endDate: refEnd },
      settledDays,
      totalGrossPrincipal: totalGross,
      asinsSeen: bySku.size,    // legacy field name; now counts SKUs
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


// Re-export PerSkuFees for any caller that wants raw SKU rows.
export type { PerSkuFees };
