import { type NextRequest } from "next/server";
import { listAccounts } from "@/lib/db/accounts";
import { getOverviewForAccount } from "@/lib/amazon-api/overview-service";

/**
 * GET /api/overview/all?dateRange=…
 *
 * Cross-account dashboard view. Calls getOverviewForAccount() in parallel for
 * every connected account (in-process, no HTTP roundtrip). Returns per-brand
 * summaries plus currency-grouped totals — we do not FX-convert.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const datePreset = searchParams.get("dateRange") ?? "Last 30D";

  const accounts = listAccounts();
  if (accounts.length === 0) {
    return Response.json({ accounts: [], byCurrency: {}, errors: [] });
  }

  const results = await Promise.allSettled(
    accounts.map((a) => getOverviewForAccount(a.id, datePreset).then((data) => ({ account: a, data }))),
  );

  type BrandRow = {
    accountId: string;
    name: string;
    color: string;
    marketplace: string;
    currency: string;
    profileId: string;
    spend: number;
    sales: number;
    orders: number;
    roas: number;
    acos: number;
    ctr: number;
    cpc: number;
    spendByType: { name: string; code: string; value: number; color: string }[];
    dailySeries: { date: string; spend: number; sales: number }[];
    activeCampaigns: number;
    error?: string;
  };

  const rows: BrandRow[] = [];
  const errors: { accountId: string; name: string; error: string }[] = [];

  results.forEach((res, i) => {
    const a = accounts[i];
    if (res.status === "rejected") {
      const errMsg = res.reason instanceof Error ? res.reason.message : String(res.reason);
      errors.push({ accountId: a.id, name: a.name, error: errMsg });
      rows.push({
        accountId: a.id, name: a.name, color: a.color,
        marketplace: a.adsMarketplace,
        currency: a.adsMarketplace === "IN" ? "INR" : "USD",
        profileId: a.adsProfileId,
        spend: 0, sales: 0, orders: 0, roas: 0, acos: 0, ctr: 0, cpc: 0,
        spendByType: [], dailySeries: [], activeCampaigns: 0,
        error: errMsg,
      });
      return;
    }
    const d = res.value.data;
    rows.push({
      accountId:   a.id,
      name:        a.name,
      color:       a.color,
      marketplace: a.adsMarketplace,
      currency:    d.currency,
      profileId:   a.adsProfileId,
      spend:       d.kpis.spend.value,
      sales:       d.kpis.sales.value,
      orders:      d.kpis.orders.value,
      roas:        d.kpis.roas.value,
      acos:        d.kpis.acos.value,
      ctr:         d.kpis.ctr.value,
      cpc:         d.kpis.cpc.value,
      spendByType: d.spendByType.map((s) => ({ name: s.name, code: s.code, value: s.value, color: s.color })),
      dailySeries: d.dailySeries.map((p) => ({ date: p.date, spend: p.spend, sales: p.sales })),
      activeCampaigns: d.campaigns.filter((c) => c.status === "ENABLED").length,
    });
  });

  // Group totals by currency (no FX conversion).
  const byCurrency: Record<string, {
    currency: string;
    spend: number; sales: number; orders: number;
    roas: number; acos: number;
    accounts: number;
  }> = {};
  for (const r of rows) {
    const g = byCurrency[r.currency] ?? {
      currency: r.currency, spend: 0, sales: 0, orders: 0, roas: 0, acos: 0, accounts: 0,
    };
    g.spend  += r.spend;
    g.sales  += r.sales;
    g.orders += r.orders;
    g.accounts += 1;
    byCurrency[r.currency] = g;
  }
  Object.values(byCurrency).forEach((g) => {
    g.roas = g.spend > 0 ? round2(g.sales / g.spend) : 0;
    g.acos = g.sales > 0 ? round2((g.spend / g.sales) * 100) : 0;
    g.spend = round2(g.spend);
    g.sales = round2(g.sales);
  });

  return Response.json({
    accounts: rows,
    byCurrency,
    errors,
    dateRange: datePreset,
  });
}

function round2(n: number) { return Math.round(n * 100) / 100; }
