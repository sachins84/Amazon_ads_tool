/**
 * GET /api/brand-analytics?report=search-terms|sqp|catalog&accountId=...&dateRange=...
 *
 * Returns one of three Brand Analytics reports from SP-API.
 */
import { type NextRequest } from "next/server";
import { withCache } from "@/lib/cache";
import { SpConfigError } from "@/lib/sp-api/client";
import { dateRangeFromPreset } from "@/lib/amazon-api/transform";
import { getAccount } from "@/lib/db/accounts";
import {
  fetchSearchTermsReport,
  fetchSQPReport,
  fetchCatalogPerformanceReport,
} from "@/lib/sp-api/brand-analytics";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const accountId  = searchParams.get("accountId") ?? "";
  const datePreset = searchParams.get("dateRange") ?? "Last 30D";
  const report     = searchParams.get("report") ?? "search-terms";

  // Resolve marketplaceId
  let marketplaceId = process.env.SP_API_MARKETPLACE_ID ?? "";
  if (accountId) {
    const acct = getAccount(accountId);
    if (acct?.spMarketplaceId) marketplaceId = acct.spMarketplaceId;
  }

  if (!marketplaceId) {
    return Response.json(
      { error: "No SP-API marketplace configured.", code: "CONFIG_MISSING" },
      { status: 200 }
    );
  }

  const cacheKey = `brand-analytics:${report}:${marketplaceId}:${datePreset}`;

  try {
    const data = await withCache(cacheKey, async () => {
      const { startDate, endDate } = dateRangeFromPreset(datePreset);

      switch (report) {
        case "search-terms":
          return { searchTerms: await fetchSearchTermsReport(marketplaceId, startDate, endDate, accountId || undefined) };
        case "sqp":
          return { sqp: await fetchSQPReport(marketplaceId, startDate, endDate, accountId || undefined) };
        case "catalog":
          return { catalogPerformance: await fetchCatalogPerformanceReport(marketplaceId, startDate, endDate, accountId || undefined) };
        default:
          throw new Error(`Unknown report type: ${report}`);
      }
    });

    return Response.json({ ...data, _source: "live" });
  } catch (err) {
    if (err instanceof SpConfigError) {
      return Response.json({ error: err.message, code: "CONFIG_MISSING" }, { status: 200 });
    }
    console.error("[brand-analytics] Error:", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
