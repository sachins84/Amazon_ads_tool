/**
 * GET /api/sales
 * Returns total revenue, orders, and units from SP-API (Seller Central).
 * Used by the frontend to compute TACoS and show organic vs ad revenue split.
 */
import { type NextRequest } from "next/server";
import { fetchSalesSummary, fetchDailySales } from "@/lib/sp-api/orders";
import { fetchSalesTrafficReport } from "@/lib/sp-api/sales-report";
import { fetchVendorSalesReport } from "@/lib/sp-api/vendor-sales-report";
import { fetchBrandSplitSales, brandKeyFromAccountName } from "@/lib/sp-api/brand-split-sales";
import { withCache } from "@/lib/cache";
import { SpConfigError, getSpMarketplaceId } from "@/lib/sp-api/client";
import { dateRangeFromPreset } from "@/lib/amazon-api/transform";
import { getAccount, getAccountRtoFactor } from "@/lib/db/accounts";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const accountId     = searchParams.get("accountId") ?? "";
  const datePreset    = searchParams.get("dateRange") ?? "Last 30D";
  const source        = searchParams.get("source") ?? "report"; // "orders" | "report"

  // Resolve marketplaceId + salesSource + vendorCode from the DB account.
  let marketplaceId = searchParams.get("marketplaceId") ?? getSpMarketplaceId() ?? "";
  let salesSource: "seller" | "vendor" = "seller";
  let vendorCode: string | null = null;
  let brandKey:   ReturnType<typeof brandKeyFromAccountName> = null;
  if (accountId) {
    const acct = getAccount(accountId);
    if (acct?.spMarketplaceId) marketplaceId = acct.spMarketplaceId;
    if (acct?.salesSource === "vendor") salesSource = "vendor";
    if (acct?.vendorCode) vendorCode = acct.vendorCode;
    if (acct?.name) brandKey = brandKeyFromAccountName(acct.name);
  }

  if (!marketplaceId) {
    return Response.json(
      { error: "No SP-API marketplace configured. Set SP_API_MARKETPLACE_ID in .env.local or on /accounts.", code: "CONFIG_MISSING" },
      { status: 200 }
    );
  }
  if (salesSource === "vendor" && !vendorCode) {
    return Response.json(
      { error: "Vendor accounts need vendor_code set on /accounts to scope the Vendor Sales Report.", code: "CONFIG_MISSING" },
      { status: 200 }
    );
  }

  // Cache key must include salesSource + vendorCode + brandKey so different
  // brands on the same marketplace don't share a cached response.
  const cacheKey = `sales:${marketplaceId}:${salesSource}:${vendorCode ?? "-"}:${brandKey ?? "-"}:${datePreset}:${source}`;

  try {
    const data = await withCache(cacheKey, async () => {
      const { startDate, endDate } = dateRangeFromPreset(datePreset);

      if (salesSource === "vendor") {
        // Vendor Sales Report scoped by vendorCode — Mosaic's India SP-API
        // auth sees multiple vendor codes; we filter per-brand.
        const rows = await fetchVendorSalesReport(marketplaceId, startDate, endDate, vendorCode!);
        const summary = rows.reduce(
          (acc, r) => ({
            totalRevenue: Math.round((acc.totalRevenue + r.totalRevenue) * 100) / 100,
            totalOrders:  acc.totalOrders + r.totalOrders,
            totalUnits:   acc.totalUnits  + r.totalUnits,
          }),
          { totalRevenue: 0, totalOrders: 0, totalUnits: 0 },
        );
        const dailySeries = rows.map((r) => ({
          date: r.date, totalRevenue: r.totalRevenue, totalOrders: r.totalOrders, totalUnits: r.totalUnits,
        }));
        return { summary, dailySeries };
      }

      if (source === "report") {
        // Sales & Traffic report — Seller Central. If we can derive a brand
        // key from the account name, pull at asinGranularity=CHILD + filter
        // by inferred brand so multi-brand sellers (Mosaic) get per-brand
        // totals instead of the whole-marketplace aggregate.
        if (brandKey) {
          const split = await fetchBrandSplitSales(marketplaceId, startDate, endDate, brandKey, accountId);
          return { summary: split.summary, dailySeries: split.dailySeries, _diagnostics: split.diagnostics };
        }
        const rows = await fetchSalesTrafficReport(marketplaceId, startDate, endDate);
        const summary = rows.reduce(
          (acc, row) => ({
            totalRevenue: Math.round((acc.totalRevenue + (row.orderedProductSales?.amount ?? 0)) * 100) / 100,
            totalOrders:  acc.totalOrders + (row.totalOrderItems ?? 0),
            totalUnits:   acc.totalUnits + (row.unitsOrdered ?? 0),
          }),
          { totalRevenue: 0, totalOrders: 0, totalUnits: 0 }
        );
        const dailySeries = rows.map((row) => ({
          date:         row.date,
          totalRevenue: row.orderedProductSales?.amount ?? 0,
          totalOrders:  row.totalOrderItems ?? 0,
          totalUnits:   row.unitsOrdered ?? 0,
        }));
        return { summary, dailySeries };
      }

      // Orders API — faster, near real-time
      const [sumRes, dailyRes] = await Promise.all([
        fetchSalesSummary(marketplaceId, startDate, endDate),
        fetchDailySales(marketplaceId, startDate, endDate),
      ]);
      return { summary: sumRes, dailySeries: dailyRes };
    });

    // Mirror metrics-store: apply the account's RTO factor to gross SP-API
    // sales so Master Overview's "Total sales" matches the post-RTO scale
    // of "Paid sales", and TACoS uses a consistent denominator. Builds
    // fresh objects (don't mutate `data` — it's the cached reference).
    const rto = accountId ? getAccountRtoFactor(accountId) : 0;
    const m = 1 - rto;
    const summary = m === 1 ? data.summary : {
      totalRevenue: data.summary.totalRevenue * m,
      totalOrders:  data.summary.totalOrders  * m,
      totalUnits:   data.summary.totalUnits   * m,
    };
    const dailySeries = m === 1 ? data.dailySeries : data.dailySeries.map((d) => ({
      ...d,
      totalRevenue: d.totalRevenue * m,
      totalOrders:  d.totalOrders  * m,
      totalUnits:   d.totalUnits   * m,
    }));
    const diagnostics = (data as { _diagnostics?: unknown })._diagnostics;
    return Response.json({ summary, dailySeries, _source: "live", _rtoApplied: rto, _diagnostics: diagnostics });
  } catch (err) {
    if (err instanceof SpConfigError) {
      return Response.json({ error: err.message, code: "CONFIG_MISSING" }, { status: 200 });
    }
    // Any other failure (401 from SP token refresh, 4xx/5xx report fetch,
    // network) returns 200 with a code field so the dashboard's
    // graceful-degradation check (!code) treats it like CONFIG_MISSING
    // and shows the hint card instead of crashing the whole React tree.
    console.error("[sales] Error:", err);
    return Response.json({ error: String(err), code: "SP_API_ERROR" }, { status: 200 });
  }
}
