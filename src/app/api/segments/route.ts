import { type NextRequest } from "next/server";
import {
  readCampaignMeta, readCampaignMetrics,
} from "@/lib/db/metrics-store";
import { dateRangeFromPreset } from "@/lib/amazon-api/transform";
import { inferIntent, ALL_INTENTS, intentLabel, type Intent } from "@/lib/amazon-api/intent";
import { ALL_OPTIMIZER_PROGRAMS, type OptimizerProgram } from "@/lib/optimizer/programs";

export const dynamic = "force-dynamic";

/**
 * GET /api/segments?accountId=…&dateRange=Last+7D
 *
 * Returns the same metrics rolled up three ways:
 *   - byIntent     : Brand vs Comp vs Generic vs Auto vs PAT vs Other
 *   - byProgram    : SP vs SB vs SB Video vs SD
 *   - byIntentProgram (matrix) : every cell of intent × program
 *
 * ASIN-level is deferred until the daily refresh starts pulling
 * spAdvertisedProduct reports — flagged in the UI.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const accountId = sp.get("accountId");
  const preset = sp.get("dateRange") ?? "Last 7D";
  if (!accountId) return Response.json({ error: "accountId required" }, { status: 400 });

  const range = dateRangeFromPreset(preset);
  const meta = readCampaignMeta(accountId);
  const rows = readCampaignMetrics(accountId, range.startDate, range.endDate);

  // Per-campaign roll-up first so we can attach (intent, programKey) labels.
  interface AggBase { spend: number; sales: number; orders: number; clicks: number; impressions: number }
  const perCamp = new Map<string, AggBase>();
  for (const r of rows) {
    const cur = perCamp.get(r.campaignId) ?? { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 };
    cur.spend += r.cost; cur.sales += r.sales; cur.orders += r.orders;
    cur.clicks += r.clicks; cur.impressions += r.impressions;
    perCamp.set(r.campaignId, cur);
  }

  const tagged = meta.map((m) => {
    const a = perCamp.get(m.campaignId) ?? { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 };
    const programKey: OptimizerProgram = m.program === "SB" && m.format === "VIDEO" ? "SB_VIDEO" : m.program;
    const intent = inferIntent(m.name);
    return { programKey, intent, ...a };
  });

  // ── Totals ──
  const total = tagged.reduce((t, r) => ({
    spend:       t.spend       + r.spend,
    sales:       t.sales       + r.sales,
    orders:      t.orders      + r.orders,
    clicks:      t.clicks      + r.clicks,
    impressions: t.impressions + r.impressions,
  }), { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 });

  // ── By intent ──
  const intentMap = new Map<Intent, AggBase>();
  for (const t of tagged) {
    const cur = intentMap.get(t.intent) ?? { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 };
    cur.spend += t.spend; cur.sales += t.sales; cur.orders += t.orders;
    cur.clicks += t.clicks; cur.impressions += t.impressions;
    intentMap.set(t.intent, cur);
  }
  const byIntent = ALL_INTENTS.map((i) => {
    const a = intentMap.get(i) ?? { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 };
    return finalize({ label: intentLabel(i), key: i, ...a }, total.spend, total.sales);
  }).filter((r) => r.spend > 0 || r.sales > 0);

  // ── By program ──
  const programMap = new Map<OptimizerProgram, AggBase>();
  for (const t of tagged) {
    const cur = programMap.get(t.programKey) ?? { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 };
    cur.spend += t.spend; cur.sales += t.sales; cur.orders += t.orders;
    cur.clicks += t.clicks; cur.impressions += t.impressions;
    programMap.set(t.programKey, cur);
  }
  const byProgram = ALL_OPTIMIZER_PROGRAMS.map((p) => {
    const a = programMap.get(p) ?? { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 };
    return finalize({ label: programLabel(p), key: p, ...a }, total.spend, total.sales);
  }).filter((r) => r.spend > 0 || r.sales > 0);

  // ── Matrix: (intent, program) ──
  const cellMap = new Map<string, AggBase>();
  for (const t of tagged) {
    const k = `${t.intent}|${t.programKey}`;
    const cur = cellMap.get(k) ?? { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 };
    cur.spend += t.spend; cur.sales += t.sales; cur.orders += t.orders;
    cur.clicks += t.clicks; cur.impressions += t.impressions;
    cellMap.set(k, cur);
  }
  const byIntentProgram: Array<{ intent: Intent; program: OptimizerProgram } & ReturnType<typeof finalize>> = [];
  for (const i of ALL_INTENTS) {
    for (const p of ALL_OPTIMIZER_PROGRAMS) {
      const a = cellMap.get(`${i}|${p}`) ?? { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 };
      if (a.spend === 0 && a.sales === 0) continue;
      byIntentProgram.push({
        intent: i, program: p,
        ...finalize({ label: `${intentLabel(i)} · ${programLabel(p)}`, key: `${i}|${p}`, ...a }, total.spend, total.sales),
      });
    }
  }

  return Response.json({
    range,
    total: finalize({ label: "Total", key: "TOTAL", ...total }, total.spend, total.sales),
    byIntent,
    byProgram,
    byIntentProgram,
  });
}

function programLabel(p: OptimizerProgram): string {
  return p === "SB_VIDEO" ? "SB Video" : p;
}

function finalize(
  base: { label: string; key: string; spend: number; sales: number; orders: number; clicks: number; impressions: number },
  totalSpend: number,
  totalSales: number,
) {
  const acos = base.sales > 0 ? (base.spend / base.sales) * 100 : null;
  const roas = base.spend > 0 ? base.sales / base.spend : null;
  const ctr  = base.impressions > 0 ? (base.clicks / base.impressions) * 100 : 0;
  const cpc  = base.clicks > 0 ? base.spend / base.clicks : 0;
  return {
    ...base,
    acos, roas, ctr, cpc,
    spendShare: totalSpend > 0 ? (base.spend / totalSpend) * 100 : 0,
    salesShare: totalSales > 0 ? (base.sales / totalSales) * 100 : 0,
  };
}
