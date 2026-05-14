import { type NextRequest } from "next/server";
import { listSPKeywords, listSPProductTargets, type SPKeyword, type SPProductTarget } from "@/lib/amazon-api/targeting";
import { fetchTargetingReport } from "@/lib/amazon-api/reports";
import { listSPAdGroups } from "@/lib/amazon-api/adgroups";
import { dateRangeFromPreset } from "@/lib/amazon-api/transform";
import { withCache } from "@/lib/cache";
import { AmazonConfigError } from "@/lib/amazon-api/token";
import { getAccount } from "@/lib/db/accounts";
import type { Target } from "@/lib/types";

/**
 * GET /api/targeting?accountId=…&dateRange=… (+ filters)
 *
 * Flat list of all SP keywords + product targets with metrics.
 * Used by the legacy /targeting-360 page; the new hierarchy-explorer uses
 * /api/adgroups/[adGroupId]/targeting instead.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const accountId  = searchParams.get("accountId") ?? "";
  const datePreset = searchParams.get("dateRange") ?? "Last 30D";

  let profileId = searchParams.get("profileId") ?? process.env.AMAZON_PROFILE_ID ?? "";
  if (accountId) {
    const acct = getAccount(accountId);
    if (!acct) return Response.json({ error: `Account ${accountId} not found` }, { status: 404 });
    profileId = acct.adsProfileId;
  }
  if (!profileId) {
    return Response.json({ error: "No profileId configured.", code: "CONFIG_MISSING" }, { status: 200 });
  }

  const { startDate, endDate } = dateRangeFromPreset(datePreset);
  const cacheKey = `targeting:flat:${accountId || profileId}:${startDate}:${endDate}`;

  try {
    const allTargets = await withCache<Target[]>(cacheKey, async () => {
      const [keywords, productTargets, adGroups, reportRows] = await Promise.all([
        listSPKeywords(profileId, {}, accountId || undefined),
        listSPProductTargets(profileId, {}, accountId || undefined),
        listSPAdGroups(profileId, accountId || undefined),
        fetchTargetingReport(profileId, startDate, endDate, accountId || undefined),
      ]);

      const adGroupName = new Map(adGroups.map((ag) => [String(ag.adGroupId), ag.name]));

      type ReportRow = {
        keywordId?: string;
        targetId?: string;
        campaignId: string;
        campaignName: string;
        adGroupId: string;
        adGroupName: string;
        impressions: number;
        clicks: number;
        cost: number;
        purchases7d?: number;
        purchases30d?: number;
        sales7d?: number;
        sales30d?: number;
      };
      const metrics = reportRows as unknown as ReportRow[];

      const byKw = new Map<string, ReportRow>(
        metrics.filter((m) => m.keywordId).map((m) => [String(m.keywordId), m]),
      );
      const byTgt = new Map<string, ReportRow>(
        metrics.filter((m) => m.targetId).map((m) => [String(m.targetId), m]),
      );

      const toTarget = (
        id: string, value: string, type: "KEYWORD" | "ASIN" | "CATEGORY" | "AUTO",
        matchType: "EXACT" | "PHRASE" | "BROAD" | "AUTO",
        state: "ENABLED" | "PAUSED" | "ARCHIVED",
        bid: number, src: SPKeyword | SPProductTarget,
        m: ReportRow | undefined,
      ): Target => {
        const spend = m?.cost ?? 0;
        const sales = Number(m?.sales7d ?? m?.sales30d ?? 0);
        const clicks = m?.clicks ?? 0;
        const orders = Number(m?.purchases7d ?? m?.purchases30d ?? 0);
        const impr   = m?.impressions ?? 0;
        return {
          id, value, type, matchType,
          campaignId:   src.campaignId,
          campaignName: m?.campaignName ?? `Campaign ${src.campaignId}`,
          adGroupId:    src.adGroupId,
          adGroupName:  adGroupName.get(src.adGroupId) ?? `Ad Group ${src.adGroupId}`,
          status: state,
          bid, suggestedBid: bid,
          impressions: impr,
          clicks,
          ctr:    impr > 0 ? Math.round((clicks / impr) * 10000) / 100 : 0,
          spend:  Math.round(spend * 100) / 100,
          orders,
          revenue: Math.round(sales * 100) / 100,
          acos:   sales > 0 ? Math.round((spend / sales) * 1000) / 10 : 0,
          roas:   spend > 0 ? Math.round((sales / spend) * 100) / 100 : 0,
          cpc:    clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : 0,
          cvr:    clicks > 0 ? Math.round((orders / clicks) * 10000) / 100 : 0,
          trend7d: [],
        };
      };

      const kwRows: Target[] = keywords.map((k) => toTarget(
        k.keywordId, k.keywordText, "KEYWORD", k.matchType, k.state,
        k.bid ?? 0, k, byKw.get(k.keywordId),
      ));

      const ptRows: Target[] = productTargets.map((t) => {
        const expr = t.expression?.[0] ?? t.resolvedExpression?.[0];
        const value = expr ? (expr.value ?? expr.type) : "Auto target";
        const type: "ASIN" | "CATEGORY" | "AUTO" =
          t.expressionType === "AUTO" ? "AUTO" :
          expr?.type === "asinSameAs" ? "ASIN" : "CATEGORY";
        return toTarget(t.targetId, value, type, "AUTO", t.state, t.bid ?? 0, t, byTgt.get(t.targetId));
      });

      return [...kwRows, ...ptRows];
    });

    // Server-side filtering
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

    const filtered = allTargets.filter((t) => {
      if (search && !t.value.toLowerCase().includes(search) && !t.campaignName.toLowerCase().includes(search)) return false;
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
      const av = a[sortBy] as number; const bv = b[sortBy] as number;
      if (typeof av === "string") return sortDir === "asc"
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
      return sortDir === "asc" ? av - bv : bv - av;
    });

    const totals = {
      spend:   filtered.reduce((s, t) => s + t.spend, 0),
      revenue: filtered.reduce((s, t) => s + t.revenue, 0),
      orders:  filtered.reduce((s, t) => s + t.orders, 0),
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
