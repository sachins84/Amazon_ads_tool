import { type NextRequest } from "next/server";
import { getAccount } from "@/lib/db/accounts";
import { dateRangeFromPreset } from "@/lib/amazon-api/transform";
import { readAsinWarehouseDaily, asinWarehouseCoverage } from "@/lib/db/asin-warehouse-store";
import { getRefreshState } from "@/lib/db/metrics-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_CACHE = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  "Pragma": "no-cache",
  "Expires": "0",
};

/**
 * GET /api/asin-warehouse?accountId=…&dateRange=Yesterday|Last+7D|Last+14D
 *
 * Returns per-ASIN × per-warehouse (ship-city + ship-state) order + unit + sales
 * totals over the chosen window. Source: SP-API All Orders flat-file report,
 * pulled by the daily refresh into `asin_warehouse_daily`.
 *
 * Returns `code: CONFIG_MISSING` (HTTP 200) when the account has no
 * spMarketplaceId set — the UI shows a config-hint card rather than an error.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const accountId = searchParams.get("accountId") ?? "";
  const datePreset = searchParams.get("dateRange") ?? "Yesterday";

  if (!accountId) {
    return Response.json({ error: "accountId is required", code: "CONFIG_MISSING" }, { status: 200, headers: NO_CACHE });
  }

  const acct = getAccount(accountId);
  if (!acct) {
    return Response.json({ error: `Account ${accountId} not found` }, { status: 404, headers: NO_CACHE });
  }
  if (!acct.spMarketplaceId) {
    return Response.json({
      code: "CONFIG_MISSING",
      message: `SP-API marketplace not configured for ${acct.name}. Set spMarketplaceId on the /accounts page to enable.`,
      brandName: acct.name,
    }, { status: 200, headers: NO_CACHE });
  }

  const { startDate, endDate } = dateRangeFromPreset(datePreset);

  const rawRows = readAsinWarehouseDaily(accountId, startDate, endDate);

  // Aggregate by (asin, ship_city, ship_state) — the daily rows roll up to a
  // single row per asin/warehouse for the chosen window.
  interface Agg {
    asin: string; asinTitle: string | null;
    shipCity: string; shipState: string;
    orders: number; units: number; sales: number;
  }
  const map = new Map<string, Agg>();
  for (const r of rawRows) {
    const k = `${r.asin}|${r.shipCity}|${r.shipState}`;
    const cur = map.get(k) ?? {
      asin: r.asin, asinTitle: r.asinTitle,
      shipCity: r.shipCity, shipState: r.shipState,
      orders: 0, units: 0, sales: 0,
    };
    cur.orders += r.orders;
    cur.units  += r.units;
    cur.sales  += r.sales;
    // Prefer the most-populated title across daily rows.
    if (!cur.asinTitle && r.asinTitle) cur.asinTitle = r.asinTitle;
    map.set(k, cur);
  }

  const rows = [...map.values()]
    .map((r) => ({ ...r, sales: Math.round(r.sales * 100) / 100 }))
    .sort((a, b) => b.sales - a.sales);

  const totals = rows.reduce(
    (acc, r) => ({
      orders: acc.orders + r.orders,
      units:  acc.units  + r.units,
      sales:  acc.sales  + r.sales,
    }),
    { orders: 0, units: 0, sales: 0 },
  );

  const refresh = getRefreshState(accountId, "asin_warehouse");
  const coverage = asinWarehouseCoverage(accountId);

  return Response.json({
    brandName: acct.name,
    marketplace: acct.adsMarketplace,
    currency: acct.adsMarketplace === "IN" ? "INR" : "USD",
    dateRange: { startDate, endDate },
    rows,
    totals: {
      orders: totals.orders,
      units:  totals.units,
      sales:  Math.round(totals.sales * 100) / 100,
      asins:  new Set(rows.map((r) => r.asin)).size,
      warehouses: new Set(rows.map((r) => `${r.shipCity}|${r.shipState}`)).size,
    },
    freshness: {
      lastRefreshAt: refresh?.lastRefreshAt ?? null,
      error:         refresh?.error ?? null,
      coverageMin:   coverage.min,
      coverageMax:   coverage.max,
      stale:         coverage.max == null || endDate > coverage.max,
    },
  }, { headers: NO_CACHE });
}
