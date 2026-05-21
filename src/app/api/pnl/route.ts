import { type NextRequest } from "next/server";
import { getAccount } from "@/lib/db/accounts";
import { getDb } from "@/lib/db";
import { dateRangeFromPreset } from "@/lib/amazon-api/transform";
import { fetchBrandSplitSales, brandKeyFromAccountName } from "@/lib/sp-api/brand-split-sales";
import { getSpMarketplaceId } from "@/lib/sp-api/client";

export const dynamic = "force-dynamic";

/**
 * GET /api/pnl?accountId=…&dateRange=Last+7D
 *
 * Brand-wise P&L waterfall:
 *
 *   gross_sales                   ← SP-API brand-split (pre-RTO)
 *   − rto                          ← gross × rto_factor
 *   = post_rto_sales
 *   − gst                          ← post_rto × gst_pct
 *   − reviews                      ← post_rto × reviews_pct
 *   − commission                   ← post_rto × commission_pct
 *   = net_revenue
 *   − logistics                    ← post_rto × logistics_pct
 *   − ad_spend                     ← campaign_metrics_daily sum for the period
 *   − cogs                         ← post_rto × cogs_pct
 *   = cm2                          ← contribution margin 2
 *
 * Every factor (rto, gst, reviews, commission, logistics, cogs) is per-brand
 * and stored on accounts.* — editable on /accounts. Ad spend comes from the
 * actual ads metrics store (already RTO-aware doesn't apply — spend stays as-is).
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const accountId  = sp.get("accountId");
  const datePreset = sp.get("dateRange") ?? "Last 7D";
  if (!accountId) return Response.json({ error: "accountId required" }, { status: 400 });

  const acct = getAccount(accountId);
  if (!acct) return Response.json({ error: "Account not found" }, { status: 404 });

  const range = dateRangeFromPreset(datePreset);
  const brandKey = brandKeyFromAccountName(acct.name);
  if (!brandKey) {
    return Response.json({
      error: `Couldn't infer a brand key from account name "${acct.name}" — add a Man Matters / Be Bodywise / Little Joys token to the name, or extend brand-split-sales.ts patterns.`,
      code: "BRAND_KEY_UNKNOWN",
    }, { status: 200 });
  }

  // 1) Gross sales (pre-RTO) via brand-split
  const marketplaceId = acct.spMarketplaceId || getSpMarketplaceId() || "";
  if (!marketplaceId) {
    return Response.json({ error: "No SP-API marketplace configured.", code: "CONFIG_MISSING" }, { status: 200 });
  }
  let grossSales = 0;
  let salesError: string | null = null;
  let salesDiagnostics: unknown = null;
  try {
    const split = await fetchBrandSplitSales(marketplaceId, range.startDate, range.endDate, brandKey);
    grossSales = split.summary.totalRevenue;
    salesDiagnostics = split.diagnostics;
  } catch (e) {
    salesError = String(e);
  }

  // 2) Ad spend from campaign_metrics_daily (NOT post-RTO — spend is spend)
  const adSpendRow = getDb().prepare(`
    SELECT COALESCE(SUM(cost), 0) AS spend
    FROM campaign_metrics_daily
    WHERE account_id = ? AND date BETWEEN ? AND ?
  `).get(accountId, range.startDate, range.endDate) as { spend: number };
  const adSpend = adSpendRow?.spend ?? 0;

  // 3) Apply factors to build the waterfall
  const rto         = grossSales * acct.rtoFactor;
  const postRtoSales = grossSales - rto;
  const gst         = postRtoSales * acct.gstPct;
  const reviews     = postRtoSales * acct.reviewsPct;
  const commission  = postRtoSales * acct.commissionPct;
  const netRevenue  = postRtoSales - gst - reviews - commission;
  const logistics   = postRtoSales * acct.logisticsPct;
  const cogs        = postRtoSales * acct.cogsPct;
  const cm2         = netRevenue - logistics - adSpend - cogs;
  const cm2Pct      = grossSales > 0 ? (cm2 / grossSales) * 100 : 0;

  return Response.json({
    accountId,
    accountName: acct.name,
    brandKey,
    dateRange: datePreset,
    range,
    waterfall: {
      grossSales,
      rto:        { factor: acct.rtoFactor,       amount: rto },
      postRtoSales,
      gst:        { factor: acct.gstPct,          amount: gst },
      reviews:    { factor: acct.reviewsPct,      amount: reviews },
      commission: { factor: acct.commissionPct,   amount: commission },
      netRevenue,
      logistics:  { factor: acct.logisticsPct,    amount: logistics },
      adSpend,
      cogs:       { factor: acct.cogsPct,         amount: cogs },
      cm2,
      cm2Pct,
    },
    salesError,
    salesDiagnostics,
  });
}
