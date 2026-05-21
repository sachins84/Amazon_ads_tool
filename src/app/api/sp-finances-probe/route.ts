import { type NextRequest } from "next/server";
import { fetchSellerFeeAggregates } from "@/lib/sp-api/finances";

export const dynamic = "force-dynamic";

/**
 * GET /api/sp-finances-probe?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 *
 * Diagnostic — returns the top-N SKUs from /finances/v0/financialEvents
 * with their commission + logistics totals, so we can see exactly what
 * the brand-fees code is trying to match against Catalog.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const startDate = sp.get("startDate");
  const endDate   = sp.get("endDate");
  const limit     = parseInt(sp.get("limit") ?? "30", 10);
  if (!startDate || !endDate) {
    return Response.json({ error: "startDate and endDate required (YYYY-MM-DD)" }, { status: 400 });
  }
  try {
    const fees = await fetchSellerFeeAggregates(startDate, endDate);
    const rows = [...fees.bySku.values()]
      .sort((a, b) => (b.commission + b.fulfillment + b.storage) - (a.commission + a.fulfillment + a.storage))
      .slice(0, limit);
    return Response.json({
      startDate, endDate,
      totals: {
        commission: fees.commission, fulfillment: fees.fulfillment,
        storage: fees.storage, refunds: fees.refunds,
        skusSeen: fees.bySku.size, totalEvents: fees.totalEvents,
      },
      top: rows,
    });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 200 });
  }
}
