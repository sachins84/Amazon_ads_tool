/**
 * GET /api/sales
 * Returns total revenue, orders, and units from SP-API (Seller Central).
 * Used by the frontend to compute TACoS and show organic vs ad revenue split.
 */
import { type NextRequest } from "next/server";
import { fetchSalesSummary, fetchDailySales } from "@/lib/sp-api/orders";
import { fetchSalesTrafficReport } from "@/lib/sp-api/sales-report";
import { withCache } from "@/lib/cache";
import { SpConfigError } from "@/lib/sp-api/client";
import { dateRangeFromPreset } from "@/lib/amazon-api/transform";
import { getAccount } from "@/lib/db/accounts";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const accountId     = searchParams.get("accountId") ?? "";
  const datePreset    = searchParams.get("dateRange") ?? "Last 30D";
  const source        = searchParams.get("source") ?? "report"; // "orders" | "report"

  // Resolve marketplaceId from DB account or env var
  let marketplaceId = searchParams.get("marketplaceId") ?? process.env.SP_API_MARKETPLACE_ID ?? "";
  if (accountId) {
    const acct = getAccount(accountId);
    if (acct?.spMarketplaceId) marketplaceId = acct.spMarketplaceId;
  }

  if (!marketplaceId) {
    return Response.json(
      { error: "No SP-API marketplace configured. Set SP_API_MARKETPLACE_ID in .env.local.", code: "CONFIG_MISSING" },
      { status: 200 }
    );
  }

  const cacheKey = `sales:${marketplaceId}:${datePreset}:${source}`;

  try {
    const data = await withCache(cacheKey, async () => {
      const { startDate, endDate } = dateRangeFromPreset(datePreset);

      if (source === "report") {
        // Sales & Traffic report — richer data, takes ~30s to generate
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
      } else {
        // Orders API — faster, near real-time
        const [summary, dailySeries] = await Promise.all([
          fetchSalesSummary(marketplaceId, startDate, endDate),
          fetchDailySales(marketplaceId, startDate, endDate),
        ]);
        return { summary, dailySeries };
      }
    });

    return Response.json({ ...data, _source: "live" });
  } catch (err) {
    if (err instanceof SpConfigError) {
      return Response.json({ error: err.message, code: "CONFIG_MISSING" }, { status: 200 });
    }
    console.error("[sales] Error:", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
