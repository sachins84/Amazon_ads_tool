/**
 * GET /api/brand-analytics?report=search-terms|sqp|catalog&accountId=...&dateRange=...&compare=true
 *
 * Returns Brand Analytics reports from SP-API.
 * When compare=true, also fetches previous period (WoW or MoM) for trend comparison.
 */
import { type NextRequest } from "next/server";
import { cacheGet, cacheSet } from "@/lib/cache";
import { getAccount } from "@/lib/db/accounts";
import {
  fetchCatalogPerformanceReport,
  fetchCatalogDirect,
  fetchSearchTermsReport,
  fetchSQPReport,
  resolvePeriod,
  previousPeriod,
} from "@/lib/sp-api/brand-analytics";
import type { CatalogPerformanceRow } from "@/lib/types";

const FAIL_SENTINEL = "__BRAND_ANALYTICS_FAILED__";
const CONFIG_MISSING_RESPONSE = { code: "CONFIG_MISSING" };

async function enrichCatalog(
  rows: CatalogPerformanceRow[],
  marketplaceId: string,
  accountId?: string
) {
  if (!rows.length) return;
  const { lookupAsins } = await import("@/lib/sp-api/catalog");
  const asins = [...new Set(rows.map((r) => r.asin).filter(Boolean))];
  const asinInfo = await lookupAsins(asins, marketplaceId, accountId);
  for (const row of rows) {
    const info = asinInfo.get(row.asin);
    if (info) { row.productTitle = info.title; row.brandName = info.brand; }
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const accountId  = searchParams.get("accountId") ?? "";
  const datePreset = searchParams.get("dateRange") ?? "Last 30D";
  const report     = searchParams.get("report") ?? "search-terms";
  const compare    = searchParams.get("compare") === "true";

  // Resolve marketplace
  let marketplaceId = process.env.SP_API_MARKETPLACE_ID ?? "";
  let hasSpCredentials = !!(process.env.SP_API_REFRESH_TOKEN);
  if (accountId) {
    const acct = getAccount(accountId);
    if (acct?.spMarketplaceId) marketplaceId = acct.spMarketplaceId;
    if (acct?.spRefreshToken) hasSpCredentials = true;
  }
  if (!marketplaceId || !hasSpCredentials) {
    return Response.json(CONFIG_MISSING_RESPONSE, { status: 200 });
  }

  // Resolve actual dates so cache key is stable across presets that map to the same period
  const period = resolvePeriod(datePreset);
  const cacheKey = `brand-analytics:${report}:${marketplaceId}:${period.start}:${period.end}${compare ? ":cmp" : ""}`;

  const cached = cacheGet<unknown>(cacheKey);
  if (cached === FAIL_SENTINEL) return Response.json(CONFIG_MISSING_RESPONSE, { status: 200 });
  if (cached) return Response.json({ ...cached as Record<string, unknown>, _source: "live" });

  if (report === "probe") {
    const probeKey = `brand-analytics:probe:${marketplaceId}`;
    const probeResult = cacheGet<string>(probeKey);
    if (probeResult === "ok") return Response.json({ status: "ok" });
    if (probeResult === "fail") return Response.json(CONFIG_MISSING_RESPONSE, { status: 200 });
    try {
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
    let data: Record<string, unknown>;
    const acctId = accountId || undefined;

    switch (report) {
      case "search-terms":
        data = { searchTerms: await fetchSearchTermsReport(marketplaceId, "", "", acctId, datePreset) };
        break;
      case "sqp":
        data = { sqp: await fetchSQPReport(marketplaceId, "", "", acctId, datePreset) };
        break;
      case "catalog": {
        const rows = await fetchCatalogPerformanceReport(marketplaceId, "", "", acctId, datePreset);
        await enrichCatalog(rows, marketplaceId, acctId);

        // Fetch last 4 weeks for trendline (current + 3 previous)
        const weeklyData: CatalogPerformanceRow[][] = [rows]; // index 0 = current
        if (compare) {
          let pp = period;
          for (let w = 0; w < 3; w++) {
            pp = previousPeriod(pp);
            const wCacheKey = `brand-analytics:catalog:${marketplaceId}:${pp.start}:${pp.end}`;
            const wCached = cacheGet<{ catalogPerformance: CatalogPerformanceRow[] }>(wCacheKey);
            if (wCached) {
              weeklyData.push(wCached.catalogPerformance);
            } else {
              try {
                const wRows = await fetchCatalogDirect(marketplaceId, pp.start, pp.end, pp.period, acctId);
                await enrichCatalog(wRows, marketplaceId, acctId);
                cacheSet(wCacheKey, { catalogPerformance: wRows });
                weeklyData.push(wRows);
              } catch {
                weeklyData.push([]);
              }
            }
          }
        }

        // Build per-ASIN weekly trend: { asin -> [w0(oldest), w1, w2, w3(current)] }
        const weeklyTrends: Record<string, { impressions: number[]; clicks: number[]; addToCarts: number[]; purchases: number[] }> = {};
        if (weeklyData.length > 1) {
          // weeklyData[0]=current, [1]=prev1, [2]=prev2, [3]=prev3 — reverse to chronological
          const chronological = [...weeklyData].reverse();
          for (const weekRows of chronological) {
            for (const r of weekRows) {
              if (!weeklyTrends[r.asin]) weeklyTrends[r.asin] = { impressions: [], clicks: [], addToCarts: [], purchases: [] };
            }
          }
          for (const asin of Object.keys(weeklyTrends)) {
            for (const weekRows of chronological) {
              const row = weekRows.find((r) => r.asin === asin);
              weeklyTrends[asin].impressions.push(row?.impressions ?? 0);
              weeklyTrends[asin].clicks.push(row?.clicks ?? 0);
              weeklyTrends[asin].addToCarts.push(row?.addToCarts ?? 0);
              weeklyTrends[asin].purchases.push(row?.purchases ?? 0);
            }
          }
        }

        data = {
          catalogPerformance: rows,
          ...(compare && {
            previousPeriod: weeklyData[1] ?? [],
            weeklyTrends,
            periodLabel: period.period === "MONTH" ? "MoM" : "WoW",
            currentRange: `${period.start} to ${period.end}`,
            weeksLoaded: weeklyData.length,
          }),
        };
        break;
      }
      default:
        return Response.json({ error: `Unknown report: ${report}` }, { status: 400 });
    }

    cacheSet(cacheKey, data);
    return Response.json({ ...data, _source: "live" });
  } catch (err) {
    console.error("[brand-analytics] Error:", err);
    cacheSet(cacheKey, FAIL_SENTINEL);
    return Response.json(CONFIG_MISSING_RESPONSE, { status: 200 });
  }
}

