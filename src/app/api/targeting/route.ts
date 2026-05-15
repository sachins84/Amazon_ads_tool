import { type NextRequest } from "next/server";
import { dateRangeFromPreset } from "@/lib/amazon-api/transform";
import { readTargetingMetrics, readTargetingMeta, getRefreshState } from "@/lib/db/metrics-store";
import { getAccount } from "@/lib/db/accounts";
import type { Target } from "@/lib/types";

/**
 * GET /api/targeting?accountId=…&dateRange=… (+ filters)
 *
 * Flat list of keywords + product targets with metrics. Reads from the
 * persistent metrics store (populated by the daily 8 AM refresh). Server-side
 * filtering + pagination so large accounts don't blow up the wire.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const accountId  = searchParams.get("accountId") ?? "";
  const datePreset = searchParams.get("dateRange") ?? "Last 7D";

  if (!accountId) {
    return Response.json({ error: "accountId is required", code: "CONFIG_MISSING" }, { status: 200 });
  }
  const acct = getAccount(accountId);
  if (!acct) return Response.json({ error: `Account ${accountId} not found` }, { status: 404 });

  const { startDate, endDate } = dateRangeFromPreset(datePreset);

  // Read from store
  const dailyRows = readTargetingMetrics(accountId, startDate, endDate);
  const meta      = readTargetingMeta(accountId);
  const refreshState = getRefreshState(accountId, "targeting");

  // Aggregate metrics per target_id
  const agg = new Map<string, { impressions: number; clicks: number; cost: number; orders: number; sales: number }>();
  for (const r of dailyRows) {
    const e = agg.get(r.targetId) ?? { impressions: 0, clicks: 0, cost: 0, orders: 0, sales: 0 };
    e.impressions += r.impressions; e.clicks += r.clicks; e.cost += r.cost; e.orders += r.orders; e.sales += r.sales;
    agg.set(r.targetId, e);
  }

  // Build Target rows from meta + aggregated metrics
  const allTargets: Target[] = meta.map((m) => {
    const a = agg.get(m.targetId) ?? { impressions: 0, clicks: 0, cost: 0, orders: 0, sales: 0 };
    const spend  = a.cost;
    const sales  = a.sales;
    const clicks = a.clicks;
    const impr   = a.impressions;
    const orders = a.orders;
    return {
      id: m.targetId,
      value: m.display ?? `id ${m.targetId}`,
      type:  m.kind === "KEYWORD" ? "KEYWORD" : m.kind === "PRODUCT_TARGET" ? "ASIN" : "AUTO",
      matchType: m.matchType ?? "AUTO",
      campaignId: m.campaignId,
      campaignName: `Campaign ${m.campaignId}`,
      adGroupId: m.adGroupId,
      adGroupName: `Ad Group ${m.adGroupId}`,
      status: m.state ?? "ARCHIVED",
      bid: m.bid ?? 0,
      suggestedBid: m.bid ?? 0,
      impressions: impr, clicks,
      ctr: impr > 0 ? Math.round((clicks / impr) * 10000) / 100 : 0,
      spend: Math.round(spend * 100) / 100,
      orders,
      revenue: Math.round(sales * 100) / 100,
      acos: sales > 0 ? Math.round((spend / sales) * 1000) / 10 : 0,
      roas: spend > 0 ? Math.round((sales / spend) * 100) / 100 : 0,
      cpc:  clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : 0,
      cvr:  clicks > 0 ? Math.round((orders / clicks) * 10000) / 100 : 0,
      trend7d: [],
    };
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

  return Response.json({
    targets: paginated,
    summary,
    totalCount: filtered.length,
    freshness: {
      lastRefreshAt: refreshState?.lastRefreshAt ?? null,
      error:         refreshState?.error         ?? null,
      stale:         dailyRows.length === 0 && meta.length === 0,
    },
  });
}
