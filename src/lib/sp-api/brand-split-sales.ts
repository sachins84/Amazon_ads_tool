/**
 * Brand-split total sales — for Sellers whose ASIN catalog spans multiple
 * brands (Mosaic's case: Man Matters / BeBodywise / Little Joys all under
 * one Seller Central auth). Pulls Sales & Traffic at asinGranularity=CHILD,
 * looks up titles via Catalog API, infers brand per ASIN, and returns
 * per-brand totals.
 *
 * Daily series is pro-rated: each day's whole-marketplace total is split
 * by the brand's share of total ordered revenue across the period. Exact
 * per-brand-per-day would require running one report per day — costly.
 */
import { fetchSalesTrafficReportFull } from "./sales-report";
import { lookupAsins } from "./catalog";
import { withCache } from "@/lib/cache";

// In-flight de-duplication: when multiple brand-views fire at once they all
// need the same underlying SP report — share the single in-flight promise.
const inflight = new Map<string, Promise<Awaited<ReturnType<typeof fetchSalesTrafficReportFull>>>>();
async function getCachedReportFull(marketplaceId: string, startDate: string, endDate: string) {
  const key = `sp-report-full:${marketplaceId}:${startDate}:${endDate}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = withCache(key, () => fetchSalesTrafficReportFull(marketplaceId, startDate, endDate), 10 * 60 * 1000)
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export type BrandKey = "manmatters" | "bebodywise" | "littlejoys" | "other";

/** Patterns are lowercase substrings. Title/name is lowercased then checked
 *  against each. First match wins, evaluated in BRAND_PATTERNS order. */
const BRAND_PATTERNS: Array<{ key: BrandKey; patterns: string[] }> = [
  { key: "manmatters", patterns: [
    "man matters", "manmatters",
    "man matter",  "manmatter",   // singular variants
  ]},
  { key: "bebodywise", patterns: [
    "be bodywise", "bebodywise",
    "be body wise", "body wise", "bodywise",
  ]},
  { key: "littlejoys", patterns: [
    "little joys", "littlejoys",
    "little joy",  "littlejoy",   // singular variants
  ]},
];

function matchBrand(text: string): BrandKey | null {
  const t = (text || "").toLowerCase();
  for (const { key, patterns } of BRAND_PATTERNS) {
    for (const p of patterns) {
      if (t.includes(p)) return key;
    }
  }
  return null;
}

export function inferBrandFromTitle(title: string): BrandKey {
  return matchBrand(title) ?? "other";
}

/** Derive a brand key from an account name. Returns null when no known
 *  brand token is in the name — caller should fall back to whole-marketplace. */
export function brandKeyFromAccountName(name: string): BrandKey | null {
  return matchBrand(name);
}

export interface BrandSplitSales {
  summary: { totalRevenue: number; totalOrders: number; totalUnits: number };
  dailySeries: { date: string; totalRevenue: number; totalOrders: number; totalUnits: number }[];
  diagnostics: {
    brandKey: BrandKey;
    asinsTotal: number;
    asinsMatched: number;
    asinsUnknown: number;
    brandSharePct: number;     // brand's share of total ordered revenue, 0..100
    topUnmapped: { asin: string; title: string; revenue: number; units: number }[];
  };
}

export async function fetchBrandSplitSales(
  marketplaceId: string,
  startDate: string,
  endDate: string,
  brandKey: BrandKey,
): Promise<BrandSplitSales> {
  // Cached + de-duped so 4 brand calls share ONE SP report instead of
  // racking up rate limits with 4 identical reports.
  const full = await getCachedReportFull(marketplaceId, startDate, endDate);

  // 1) Look up titles for every ASIN in the report. Use the GLOBAL SP-API
  // client (no accountId) — credentials live in app_settings, not per-account
  // refresh tokens, so accountSpRequest would fail with
  // "no SP-API refresh token configured".
  const asins = [...new Set(full.byAsin.map((r) => r.asin))].filter(Boolean);
  const info = await lookupAsins(asins, marketplaceId);

  // 2) Split per-ASIN totals by inferred brand.
  let brandRevenue = 0;
  let brandUnits   = 0;
  let totalRevenue = 0;
  let totalUnits   = 0;
  let matched      = 0;
  let unknown      = 0;
  const unmapped: { asin: string; title: string; revenue: number; units: number }[] = [];
  for (const r of full.byAsin) {
    totalRevenue += r.orderedProductSales;
    totalUnits   += r.unitsOrdered;
    const title = info.get(r.asin)?.title ?? "";
    const inferred = inferBrandFromTitle(title);
    if (inferred === brandKey) {
      brandRevenue += r.orderedProductSales;
      brandUnits   += r.unitsOrdered;
      matched++;
    } else if (inferred === "other") {
      unknown++;
      unmapped.push({ asin: r.asin, title, revenue: r.orderedProductSales, units: r.unitsOrdered });
    }
  }
  const topUnmapped = unmapped.sort((a, b) => b.revenue - a.revenue).slice(0, 30);

  // 3) Pro-rate daily totals by the brand's share of overall revenue.
  // (Each day's salesByDate is whole-marketplace; we don't have per-ASIN-
  //  per-day in this report. Single-share is the best approximation without
  //  running one report per day.)
  const brandShare = totalRevenue > 0 ? brandRevenue / totalRevenue : 0;
  const dailySeries = full.byDate.map((d) => ({
    date:         d.date,
    totalRevenue: Math.round((d.orderedProductSales.amount ?? 0) * brandShare * 100) / 100,
    totalOrders:  Math.round((d.totalOrderItems ?? 0) * brandShare),
    totalUnits:   Math.round((d.unitsOrdered ?? 0) * brandShare),
  }));

  // brandOrders is harder — the report's byAsin has units but no "orders".
  // Pro-rate orders by share too.
  const totalOrdersDays = full.byDate.reduce((s, d) => s + (d.totalOrderItems ?? 0), 0);
  const brandOrders = Math.round(totalOrdersDays * brandShare);

  return {
    summary: {
      totalRevenue: Math.round(brandRevenue * 100) / 100,
      totalOrders:  brandOrders,
      totalUnits:   brandUnits,
    },
    dailySeries,
    diagnostics: {
      brandKey,
      asinsTotal: full.byAsin.length,
      asinsMatched: matched,
      asinsUnknown: unknown,
      brandSharePct: Math.round(brandShare * 10000) / 100,
      topUnmapped,
    },
  };
}
