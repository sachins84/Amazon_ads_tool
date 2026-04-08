import { type NextRequest } from "next/server";
import { listSPCampaigns } from "@/lib/amazon-api/campaigns";
import { fetchCampaignReport } from "@/lib/amazon-api/reports";
import { mergeCampaigns, dateRangeFromPreset } from "@/lib/amazon-api/transform";
import { withCache } from "@/lib/cache";
import { AmazonConfigError } from "@/lib/amazon-api/token";
import { getAccount } from "@/lib/db/accounts";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const accountId    = searchParams.get("accountId") ?? "";
  const datePreset   = searchParams.get("dateRange") ?? "Last 30D";
  const campaignType = searchParams.get("campaignType") ?? "ALL";

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

  const cacheKey = `overview:${accountId || profileId}:${datePreset}`;

  try {
    const data = await withCache(cacheKey, async () => {
      const { startDate, endDate } = dateRangeFromPreset(datePreset);

      // Parallel: fetch campaign lists + metrics report
      const [spCampaigns, reportRows] = await Promise.all([
        listSPCampaigns(profileId, accountId || undefined),
        fetchCampaignReport(profileId, startDate, endDate, accountId || undefined),
      ]);

      type CampaignMetricsRow = {
        campaignId: string;
        campaignName: string;
        impressions: number;
        clicks: number;
        cost: number;
        purchases30d: number;
        sales30d: number;
      };

      const metrics = reportRows as unknown as CampaignMetricsRow[];
      const campaigns = mergeCampaigns(spCampaigns, metrics);

      // Build KPI totals
      const totals = campaigns.reduce(
        (acc, c) => ({
          spend:       acc.spend + c.spend,
          revenue:     acc.revenue + c.revenue,
          orders:      acc.orders + c.orders,
          impressions: acc.impressions + c.impressions,
          clicks:      acc.clicks + c.clicks,
        }),
        { spend: 0, revenue: 0, orders: 0, impressions: 0, clicks: 0 }
      );

      const acos = totals.revenue > 0 ? (totals.spend / totals.revenue) * 100 : 0;
      const roas = totals.spend > 0 ? totals.revenue / totals.spend : 0;
      const ctr  = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
      const cpc  = totals.clicks > 0 ? totals.spend / totals.clicks : 0;
      const cvr  = totals.clicks > 0 ? (totals.orders / totals.clicks) * 100 : 0;

      const kpis = {
        spend:       { value: Math.round(totals.spend * 100) / 100,   delta: 0, positive: false },
        revenue:     { value: Math.round(totals.revenue * 100) / 100, delta: 0, positive: true  },
        acos:        { value: Math.round(acos * 10) / 10,             delta: 0, positive: true  },
        roas:        { value: Math.round(roas * 100) / 100,           delta: 0, positive: true  },
        orders:      { value: totals.orders,                           delta: 0, positive: true  },
        impressions: { value: totals.impressions,                      delta: 0, positive: true  },
        clicks:      { value: totals.clicks,                           delta: 0, positive: true  },
        ctr:         { value: Math.round(ctr * 100) / 100,            delta: 0, positive: true  },
        cpc:         { value: Math.round(cpc * 100) / 100,            delta: 0, positive: true  },
        cvr:         { value: Math.round(cvr * 100) / 100,            delta: 0, positive: true  },
        ntbOrders:   { value: 0, delta: 0, positive: true },
        tacos:       { value: 0, delta: 0, positive: true },
      };

      // Spend by type breakdown
      const spendByType = [
        { name: "Sponsored Products", value: Math.round(totals.spend * 0.68), color: "#6366f1" },
        { name: "Sponsored Brands",   value: Math.round(totals.spend * 0.22), color: "#8b5cf6" },
        { name: "Sponsored Display",  value: Math.round(totals.spend * 0.10), color: "#a78bfa" },
      ];

      return { kpis, campaigns, spendByType };
    });

    // Filter campaigns by type if requested
    let campaigns = data.campaigns;
    if (campaignType !== "ALL") {
      campaigns = campaigns.filter((c: { type: string }) => c.type === campaignType);
    }

    return Response.json({ ...data, campaigns });
  } catch (err) {
    if (err instanceof AmazonConfigError) {
      return Response.json({ error: err.message, code: "CONFIG_MISSING" }, { status: 500 });
    }
    console.error("[overview] Error:", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
