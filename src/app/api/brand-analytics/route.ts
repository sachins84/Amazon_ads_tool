/**
 * GET /api/brand-analytics?report=search-terms|sqp|catalog&accountId=...&dateRange=...
 *
 * Returns one of three Brand Analytics reports from SP-API.
 * Brand Analytics requires SP-API credentials with Brand Registry access.
 */
import { type NextRequest } from "next/server";
import { cacheGet, cacheSet } from "@/lib/cache";
import { dateRangeFromPreset } from "@/lib/amazon-api/transform";
import { getAccount } from "@/lib/db/accounts";
import {
  fetchSearchTermsReport,
  fetchSQPReport,
  fetchCatalogPerformanceReport,
} from "@/lib/sp-api/brand-analytics";

const FAIL_SENTINEL = "__BRAND_ANALYTICS_FAILED__";
const CONFIG_MISSING_RESPONSE = { code: "CONFIG_MISSING" };

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const accountId  = searchParams.get("accountId") ?? "";
  const datePreset = searchParams.get("dateRange") ?? "Last 30D";
  const report     = searchParams.get("report") ?? "search-terms";

  // Resolve marketplaceId and check SP-API credentials exist
  let marketplaceId = process.env.SP_API_MARKETPLACE_ID ?? "";
  let hasSpCredentials = !!(process.env.SP_API_REFRESH_TOKEN);

  if (accountId) {
    const acct = getAccount(accountId);
    if (acct?.spMarketplaceId) marketplaceId = acct.spMarketplaceId;
    if (acct?.spRefreshToken) hasSpCredentials = true;
  }

  // Fast bail — no marketplace or no SP-API credentials → mock immediately
  if (!marketplaceId || !hasSpCredentials) {
    console.log("[brand-analytics] bail:", { marketplaceId: !!marketplaceId, hasSpCredentials, accountId });
    return Response.json(CONFIG_MISSING_RESPONSE, { status: 200 });
  }

  const cacheKey = `brand-analytics:${report}:${marketplaceId}:${datePreset}`;

  // Check cache — includes cached failures so we don't re-hit a broken SP-API
  const cached = cacheGet<unknown>(cacheKey);
  if (cached === FAIL_SENTINEL) {
    return Response.json(CONFIG_MISSING_RESPONSE, { status: 200 });
  }
  if (cached) {
    return Response.json({ ...cached as Record<string, unknown>, _source: "live" });
  }

  // Quick probe: just check if SP-API token is valid without creating a report
  if (report === "probe") {
    const probeKey = `brand-analytics:probe:${marketplaceId}`;
    const probeResult = cacheGet<string>(probeKey);
    if (probeResult === "ok") return Response.json({ status: "ok" });
    if (probeResult === "fail") return Response.json(CONFIG_MISSING_RESPONSE, { status: 200 });

    try {
      // Lightweight SP-API call — list reports (fast, no report creation)
      const { spRequest } = await import("@/lib/sp-api/client");
      await spRequest("/reports/2021-06-30/reports?reportTypes=GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT&pageSize=1");
      cacheSet(probeKey, "ok");
      return Response.json({ status: "ok" });
    } catch {
      cacheSet(probeKey, "fail");
      return Response.json(CONFIG_MISSING_RESPONSE, { status: 200 });
    }
  }

  try {
    const { startDate, endDate } = dateRangeFromPreset(datePreset);

    let data: Record<string, unknown>;
    switch (report) {
      case "search-terms":
        data = { searchTerms: await fetchSearchTermsReport(marketplaceId, startDate, endDate, accountId || undefined, datePreset) };
        break;
      case "sqp":
        data = { sqp: await fetchSQPReport(marketplaceId, startDate, endDate, accountId || undefined, datePreset) };
        break;
      case "catalog": {
        const rows = await fetchCatalogPerformanceReport(marketplaceId, startDate, endDate, accountId || undefined, datePreset);
        // Enrich with product titles and brand names
        if (rows.length > 0) {
          const { lookupAsins } = await import("@/lib/sp-api/catalog");
          const asins = [...new Set(rows.map((r) => r.asin).filter(Boolean))];
          const asinInfo = await lookupAsins(asins, marketplaceId, accountId || undefined);
          for (const row of rows) {
            const info = asinInfo.get(row.asin);
            if (info) {
              row.productTitle = info.title;
              row.brandName = info.brand;
            }
          }
        }
        data = { catalogPerformance: rows };
        break;
      }
      default:
        return Response.json({ error: `Unknown report: ${report}` }, { status: 400 });
    }

    cacheSet(cacheKey, data);
    return Response.json({ ...data, _source: "live" });
  } catch (err) {
    // Cache the failure for 5 min so we don't re-attempt the slow SP-API call
    console.error("[brand-analytics] Error:", err);
    cacheSet(cacheKey, FAIL_SENTINEL);
    return Response.json(CONFIG_MISSING_RESPONSE, { status: 200 });
  }
}
