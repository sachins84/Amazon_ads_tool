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

export type BrandKey = "manmatters" | "bebodywise" | "littlejoys" | "other";

export function inferBrandFromTitle(title: string): BrandKey {
  const t = (title || "").toLowerCase();
  if (t.includes("man matters") || t.includes("manmatters")) return "manmatters";
  if (t.includes("be bodywise") || t.includes("bebodywise") || t.includes("bodywise")) return "bebodywise";
  if (t.includes("little joys") || t.includes("littlejoys")) return "littlejoys";
  return "other";
}

/** Derive a brand key from an account name. Returns null when no known
 *  brand token is in the name — caller should fall back to whole-marketplace. */
export function brandKeyFromAccountName(name: string): BrandKey | null {
  const n = (name || "").toLowerCase();
  if (n.includes("manmatters") || n.includes("man matters")) return "manmatters";
  if (n.includes("bebodywise") || n.includes("be bodywise") || n.includes("bodywise")) return "bebodywise";
  if (n.includes("littlejoys") || n.includes("little joys")) return "littlejoys";
  return null;
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
  };
}

export async function fetchBrandSplitSales(
  marketplaceId: string,
  startDate: string,
  endDate: string,
  brandKey: BrandKey,
): Promise<BrandSplitSales> {
  const full = await fetchSalesTrafficReportFull(marketplaceId, startDate, endDate);

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
    }
  }

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
    },
  };
}
