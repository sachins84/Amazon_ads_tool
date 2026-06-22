import { type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { getAccount } from "@/lib/db/accounts";
import { readAdvertisedProductMetrics, readCampaignMeta } from "@/lib/db/metrics-store";
import { dateRangeFromPreset } from "@/lib/amazon-api/transform";
import { inferIntent, ALL_INTENTS, type Intent } from "@/lib/amazon-api/intent";

// Same no-cache posture as /api/overview — the UI relies on fresh shape.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_CACHE = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  "Pragma":        "no-cache",
  "Expires":       "0",
};

/**
 * GET /api/overview/products?accountId=…&dateRange=…
 *
 * Product-level (ASIN) ad spend, broken out by campaign intent
 * (Brand / Generic / Competition / Auto / PAT / Other). Built from
 * advertised_product_metrics_daily, which Amazon only reports for
 * Sponsored Products — SB/SD spend is NOT represented here. The UI labels
 * the view "SP only" accordingly.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const accountId = searchParams.get("accountId") ?? "";
  const dateRange = searchParams.get("dateRange") ?? "Last 7D";

  if (!accountId) {
    return Response.json({ error: "accountId is required", code: "CONFIG_MISSING" }, { status: 200, headers: NO_CACHE });
  }

  const acct = getAccount(accountId);
  const currency = acct?.adsMarketplace === "IN" ? "INR" : "USD";
  const range = dateRangeFromPreset(dateRange);

  const rows = readAdvertisedProductMetrics(accountId, range.startDate, range.endDate);
  const intentByCampaign = new Map(readCampaignMeta(accountId).map((m) => [m.campaignId, inferIntent(m.name)]));
  const titles = readAsinTitles(accountId);

  interface Acc {
    asin: string;
    spend: number; sales: number; orders: number; clicks: number; impressions: number;
    byIntent: Record<Intent, number>;
  }
  const zeroIntent = (): Record<Intent, number> =>
    Object.fromEntries(ALL_INTENTS.map((i) => [i, 0])) as Record<Intent, number>;

  const byAsin = new Map<string, Acc>();
  const intentTotals = zeroIntent();
  for (const r of rows) {
    let a = byAsin.get(r.asin);
    if (!a) { a = { asin: r.asin, spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0, byIntent: zeroIntent() }; byAsin.set(r.asin, a); }
    a.spend += r.cost; a.sales += r.sales; a.orders += r.orders;
    a.clicks += r.clicks; a.impressions += r.impressions;
    const intent = intentByCampaign.get(r.campaignId) ?? "OTHER";
    a.byIntent[intent] += r.cost;
    intentTotals[intent] += r.cost;
  }

  const products = [...byAsin.values()]
    .map((a) => ({
      asin: a.asin,
      title: titles.get(a.asin) ?? null,
      spend: a.spend, sales: a.sales, orders: a.orders,
      clicks: a.clicks, impressions: a.impressions,
      acos: a.sales > 0 ? (a.spend / a.sales) * 100 : null,
      roas: a.spend > 0 ? a.sales / a.spend : null,
      byIntent: a.byIntent,
    }))
    .sort((x, y) => y.spend - x.spend);

  const totals = products.reduce(
    (t, p) => { t.spend += p.spend; t.sales += p.sales; t.orders += p.orders; return t; },
    { spend: 0, sales: 0, orders: 0 },
  );

  return Response.json({
    currency,
    dateRange: range,
    products,
    totals: {
      ...totals,
      acos: totals.sales > 0 ? (totals.spend / totals.sales) * 100 : null,
      asins: products.length,
    },
    intentTotals,
    source: "SP", // advertised-product report is Sponsored Products only
  }, { headers: NO_CACHE });
}

/** Latest known item-name per ASIN from the Seller warehouse report. Best-effort
 *  decoration — absent for accounts without SP-API / warehouse data. */
function readAsinTitles(accountId: string): Map<string, string> {
  const rows = getDb().prepare(`
    SELECT asin, asin_title
    FROM asin_warehouse_daily
    WHERE account_id = ? AND asin_title IS NOT NULL
    GROUP BY asin
    HAVING date = MAX(date)
  `).all(accountId) as Array<{ asin: string; asin_title: string | null }>;
  const out = new Map<string, string>();
  for (const r of rows) if (r.asin_title) out.set(r.asin, r.asin_title);
  return out;
}
