import { type NextRequest } from "next/server";
import { discoverVendorCodes } from "@/lib/sp-api/vendor-sales-report";
import { getSpMarketplaceId } from "@/lib/sp-api/client";

export const dynamic = "force-dynamic";

/**
 * POST /api/settings/discover-vendor-codes
 *   Runs an unfiltered GET_VENDOR_SALES_REPORT for yesterday and returns
 *   the unique vendor codes found in the response. Takes 5–10 min while
 *   Amazon generates the report; client should show a spinner.
 *
 * Returns: { vendorCodes: string[], sample: [{ vendorCode, asin }, ...] }
 */
export async function POST(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const marketplaceId = searchParams.get("marketplaceId") ?? getSpMarketplaceId() ?? "";
  if (!marketplaceId) {
    return Response.json({ error: "No SP-API marketplace configured." }, { status: 400 });
  }
  // Yesterday only — smallest window keeps the report fast to generate.
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  const start = end;
  const yyyymmdd = (d: Date) => d.toISOString().slice(0, 10);
  try {
    const result = await discoverVendorCodes(marketplaceId, yyyymmdd(start), yyyymmdd(end));
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 200 });
  }
}
