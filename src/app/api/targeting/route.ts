import { type NextRequest } from "next/server";
import { listSPKeywords, listSPProductTargets } from "@/lib/amazon-api/targeting";
import { fetchTargetingReport } from "@/lib/amazon-api/reports";
import { mergeKeywordTargets, mergeProductTargets, dateRangeFromPreset } from "@/lib/amazon-api/transform";
import { withCache } from "@/lib/cache";
import { amazonRequest } from "@/lib/amazon-api/client";
import { AmazonConfigError } from "@/lib/amazon-api/token";
import { getAccount } from "@/lib/db/accounts";
import type { Target } from "@/lib/types";

interface SPAdGroup {
  adGroupId: number;
  name: string;
  campaignId: number;
  state: string;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const accountId  = searchParams.get("accountId") ?? "";
  const datePreset = searchParams.get("dateRange") ?? "Last 30D";

  // Resolve profileId from DB account or fall back to env var
  let profileId = searchParams.get("profileId") ?? process.env.AMAZON_PROFILE_ID ?? "";
  if (accountId) {
    const acct = getAccount(accountId);
    if (!acct) return Response.json({ error: `Account ${accountId} not found` }, { status: 404 });
    profileId = acct.adsProfileId;
  }

  if (!profileId) {
    return Response.json({ error: "No profileId configured. Add AMAZON_PROFILE_ID to .env.local.", code: "CONFIG_MISSING" }, { status: 200 });
  }

  const cacheKey = `targeting:${accountId || profileId}:${datePreset}`;
  const reqOpts = accountId ? { accountId } : { profileId };

  try {
    const allTargets = await withCache(cacheKey, async (): Promise<Target[]> => {
      const { startDate, endDate } = dateRangeFromPreset(datePreset);

      // Fetch everything in parallel
      const [keywords, productTargets, adGroups, reportRows] = await Promise.all([
        listSPKeywords(profileId, accountId || undefined),
        listSPProductTargets(profileId, accountId || undefined),
        amazonRequest<SPAdGroup[]>("/sp/adGroups?stateFilter=enabled,paused", reqOpts),
        fetchTargetingReport(profileId, startDate, endDate, accountId || undefined),
      ]);

      const adGroupMap = new Map<number, string>(
        adGroups.map((ag) => [ag.adGroupId, ag.name])
      );

      type ReportRow = {
        keywordId?: string;
        targetId?: string;
        campaignId: string;
        campaignName: string;
        adGroupId: string;
        adGroupName: string;
        targetingText: string;
        targetingType: string;
        matchType?: string;
        impressions: number;
        clicks: number;
        cost: number;
        purchases30d: number;
        sales30d: number;
      };

      const metrics = reportRows as unknown as ReportRow[];

      const kwTargets = mergeKeywordTargets(keywords, metrics, adGroupMap);
      const prodTargets = mergeProductTargets(productTargets, metrics, adGroupMap);

      return [...kwTargets, ...prodTargets];
    });

    // Server-side filtering (so large accounts don't dump everything to client)
    const search      = searchParams.get("search")?.toLowerCase() ?? "";
    const targetType  = searchParams.get("targetType") ?? "ALL";
    const matchType   = searchParams.get("matchType") ?? "ALL";
    const status      = searchParams.get("status") ?? "ALL";
    const campaignIds = searchParams.getAll("campaignId");
    const bidMin      = parseFloat(searchParams.get("bidMin") ?? "");
    const bidMax      = parseFloat(searchParams.get("bidMax") ?? "");
    const acosMin     = parseFloat(searchParams.get("acosMin") ?? "");
    const acosMax     = parseFloat(searchParams.get("acosMax") ?? "");
    const spendMin    = parseFloat(searchParams.get("spendMin") ?? "");
    const page        = parseInt(searchParams.get("page") ?? "0", 10);
    const pageSize    = parseInt(searchParams.get("pageSize") ?? "50", 10);
    const sortBy      = (searchParams.get("sortBy") ?? "spend") as keyof Target;
    const sortDir     = searchParams.get("sortDir") ?? "desc";

    let filtered = allTargets.filter((t) => {
      if (search && !t.value.toLowerCase().includes(search) &&
          !t.campaignName.toLowerCase().includes(search)) return false;
      if (targetType !== "ALL" && t.type !== targetType) return false;
      if (matchType  !== "ALL" && t.matchType !== matchType) return false;
      if (status     !== "ALL" && t.status !== status) return false;
      if (campaignIds.length && !campaignIds.includes(t.campaignId)) return false;
      if (!isNaN(bidMin)  && t.bid < bidMin)   return false;
      if (!isNaN(bidMax)  && t.bid > bidMax)   return false;
      if (!isNaN(acosMin) && t.acos < acosMin) return false;
      if (!isNaN(acosMax) && t.acos > acosMax) return false;
      if (!isNaN(spendMin) && t.spend < spendMin) return false;
      return true;
    });

    filtered.sort((a, b) => {
      const av = a[sortBy] as number;
      const bv = b[sortBy] as number;
      if (typeof av === "string") return sortDir === "asc"
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
      return sortDir === "asc" ? av - bv : bv - av;
    });

    const totals = {
      spend:   filtered.reduce((s, t) => s + t.spend, 0),
      revenue: filtered.reduce((s, t) => s + t.revenue, 0),
      orders:  filtered.reduce((s, t) => s + t.orders, 0),
      clicks:  filtered.reduce((s, t) => s + t.clicks, 0),
    };

    const summary = {
      total:   filtered.length,
      spend:   Math.round(totals.spend * 100) / 100,
      revenue: Math.round(totals.revenue * 100) / 100,
      acos:    totals.revenue > 0 ? Math.round((totals.spend / totals.revenue) * 1000) / 10 : 0,
      roas:    totals.spend > 0 ? Math.round((totals.revenue / totals.spend) * 100) / 100 : 0,
      orders:  totals.orders,
    };

    const paginated = filtered.slice(page * pageSize, (page + 1) * pageSize);

    return Response.json({ targets: paginated, summary, totalCount: filtered.length });
  } catch (err) {
    if (err instanceof AmazonConfigError) {
      return Response.json({ error: err.message, code: "CONFIG_MISSING" }, { status: 500 });
    }
    console.error("[targeting] Error:", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
