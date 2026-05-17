import { type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import {
  readCampaignMeta, readCampaignMetrics,
  readAdGroupMeta,  readAdGroupMetrics,
  readTargetingMeta, readTargetingMetrics,
} from "@/lib/db/metrics-store";
import { dateRangeFromPreset } from "@/lib/amazon-api/transform";
import { inferIntent, type Intent } from "@/lib/amazon-api/intent";
import { buildTargetResolver, type OptimizerProgram } from "@/lib/db/acos-targets-repo";

export const dynamic = "force-dynamic";

/**
 * Hierarchical explorer for the Optimizer page.
 *
 * GET /api/optimizer/explore?accountId=…
 *   → { portfolio, campaigns }
 *
 * GET /api/optimizer/explore?accountId=…&campaignId=…
 *   → { campaign, adGroups }
 *
 * GET /api/optimizer/explore?accountId=…&adGroupId=…
 *   → { adGroup, targets }
 *
 * Every row carries 7d metrics + the latest suggestion for that entity
 * (so reviewers see what the engine recommended right next to the data
 * that drove the call).
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const accountId = sp.get("accountId");
  const campaignId = sp.get("campaignId");
  const adGroupId  = sp.get("adGroupId");
  if (!accountId) return Response.json({ error: "accountId required" }, { status: 400 });

  if (adGroupId)  return Response.json(exploreAdGroup(accountId, adGroupId));
  if (campaignId) return Response.json(exploreCampaign(accountId, campaignId));
  return Response.json(exploreAccount(accountId));
}

// ─── Per-level builders ─────────────────────────────────────────────────────

interface MetricBundle {
  spend: number; sales: number; orders: number; clicks: number; impressions: number;
  acos: number | null; roas: number | null;
}
function bundle(spend: number, sales: number, orders: number, clicks: number, impressions: number): MetricBundle {
  return {
    spend, sales, orders, clicks, impressions,
    acos: sales > 0 ? (spend / sales) * 100 : null,
    roas: spend > 0 ? sales / spend : null,
  };
}

function exploreAccount(accountId: string) {
  const r7 = dateRangeFromPreset("Last 7D");
  const meta = readCampaignMeta(accountId);
  const rows = readCampaignMetrics(accountId, r7.startDate, r7.endDate);

  // Aggregate per campaign
  const agg = new Map<string, { spend: number; sales: number; orders: number; clicks: number; impressions: number }>();
  for (const r of rows) {
    const cur = agg.get(r.campaignId) ?? { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 };
    cur.spend += r.cost; cur.sales += r.sales; cur.orders += r.orders;
    cur.clicks += r.clicks; cur.impressions += r.impressions;
    agg.set(r.campaignId, cur);
  }

  const resolveTarget = buildTargetResolver(accountId);
  const sug = latestSuggestionsByTarget(accountId, "CAMPAIGN");

  let pSpend = 0, pSales = 0, pOrders = 0, pClicks = 0, pImpressions = 0;
  const campaigns = meta.map((m) => {
    const programKey: OptimizerProgram = m.program === "SB" && m.format === "VIDEO" ? "SB_VIDEO" : m.program;
    const intent: Intent = inferIntent(m.name);
    const a = agg.get(m.campaignId) ?? { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 };
    pSpend += a.spend; pSales += a.sales; pOrders += a.orders;
    pClicks += a.clicks; pImpressions += a.impressions;
    return {
      campaignId: m.campaignId,
      name: m.name,
      program: m.program,
      programKey,
      intent,
      state: m.state,
      dailyBudget: m.dailyBudget,
      targetAcos: resolveTarget(programKey, intent),
      m7d: bundle(a.spend, a.sales, a.orders, a.clicks, a.impressions),
      suggestion: sug.get(m.campaignId) ?? null,
    };
  });

  return {
    portfolio: bundle(pSpend, pSales, pOrders, pClicks, pImpressions),
    campaigns,
    range: r7,
  };
}

function exploreCampaign(accountId: string, campaignId: string) {
  const r7 = dateRangeFromPreset("Last 7D");
  const campMeta = readCampaignMeta(accountId).find((m) => m.campaignId === campaignId);
  if (!campMeta) return { error: "Campaign not found" };

  const programKey: OptimizerProgram = campMeta.program === "SB" && campMeta.format === "VIDEO" ? "SB_VIDEO" : campMeta.program;
  const intent: Intent = inferIntent(campMeta.name);
  const resolveTarget = buildTargetResolver(accountId);
  const targetAcos = resolveTarget(programKey, intent);

  const campRows = readCampaignMetrics(accountId, r7.startDate, r7.endDate).filter((r) => r.campaignId === campaignId);
  const campAgg = campRows.reduce((acc, r) => {
    acc.spend += r.cost; acc.sales += r.sales; acc.orders += r.orders;
    acc.clicks += r.clicks; acc.impressions += r.impressions;
    return acc;
  }, { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 });

  const adGroupMeta = readAdGroupMeta(accountId, campaignId);
  const adGroupRows = readAdGroupMetrics(accountId, r7.startDate, r7.endDate, campaignId);
  const agAgg = new Map<string, typeof campAgg>();
  const adGroupsWithDirectData = new Set<string>();
  for (const r of adGroupRows) {
    adGroupsWithDirectData.add(r.adGroupId);
    const cur = agAgg.get(r.adGroupId) ?? { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 };
    cur.spend += r.cost; cur.sales += r.sales; cur.orders += r.orders;
    cur.clicks += r.clicks; cur.impressions += r.impressions;
    agAgg.set(r.adGroupId, cur);
  }
  // SP roll-up: Amazon doesn't expose an SP ad-group report, so we sum
  // targeting_metrics_daily by adGroupId for any ad group without direct data.
  // (Same pattern as hierarchy-service — see the QA catalog entry on SP rollup.)
  const tgRowsForRollup = readTargetingMetrics(accountId, r7.startDate, r7.endDate, { campaignId });
  for (const r of tgRowsForRollup) {
    if (r.program !== "SP") continue;
    if (adGroupsWithDirectData.has(r.adGroupId)) continue;
    const cur = agAgg.get(r.adGroupId) ?? { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 };
    cur.spend += r.cost; cur.sales += r.sales; cur.orders += r.orders;
    cur.clicks += r.clicks; cur.impressions += r.impressions;
    agAgg.set(r.adGroupId, cur);
  }

  const sug = latestSuggestionsByTarget(accountId, "AD_GROUP");
  const adGroups = adGroupMeta.map((m) => {
    const a = agAgg.get(m.adGroupId) ?? { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 };
    return {
      adGroupId: m.adGroupId,
      name: m.name,
      campaignId: m.campaignId,
      program: m.program,
      state: m.state,
      defaultBid: m.defaultBid,
      m7d: bundle(a.spend, a.sales, a.orders, a.clicks, a.impressions),
      suggestion: sug.get(m.adGroupId) ?? null,
    };
  });

  return {
    campaign: {
      campaignId: campMeta.campaignId,
      name: campMeta.name,
      program: campMeta.program,
      programKey,
      intent,
      state: campMeta.state,
      dailyBudget: campMeta.dailyBudget,
      targetAcos,
      m7d: bundle(campAgg.spend, campAgg.sales, campAgg.orders, campAgg.clicks, campAgg.impressions),
    },
    adGroups,
    range: r7,
  };
}

function exploreAdGroup(accountId: string, adGroupId: string) {
  const r7 = dateRangeFromPreset("Last 7D");
  const agMeta = readAdGroupMeta(accountId).find((m) => m.adGroupId === adGroupId);
  if (!agMeta) return { error: "Ad group not found" };

  const agRows = readAdGroupMetrics(accountId, r7.startDate, r7.endDate).filter((r) => r.adGroupId === adGroupId);
  const tgtMeta = readTargetingMeta(accountId, { adGroupId });
  const tgtRows = readTargetingMetrics(accountId, r7.startDate, r7.endDate, { adGroupId });

  // SP fallback: if no direct ad-group rows came back, sum the targeting rows
  // for this ad group instead — Amazon doesn't expose an SP ad-group report.
  const agAgg = agRows.length > 0
    ? agRows.reduce((acc, r) => {
        acc.spend += r.cost; acc.sales += r.sales; acc.orders += r.orders;
        acc.clicks += r.clicks; acc.impressions += r.impressions;
        return acc;
      }, { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 })
    : tgtRows.reduce((acc, r) => {
        acc.spend += r.cost; acc.sales += r.sales; acc.orders += r.orders;
        acc.clicks += r.clicks; acc.impressions += r.impressions;
        return acc;
      }, { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 });

  const tgtAgg = new Map<string, typeof agAgg>();
  for (const r of tgtRows) {
    const cur = tgtAgg.get(r.targetId) ?? { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 };
    cur.spend += r.cost; cur.sales += r.sales; cur.orders += r.orders;
    cur.clicks += r.clicks; cur.impressions += r.impressions;
    tgtAgg.set(r.targetId, cur);
  }

  const sug = new Map([
    ...latestSuggestionsByTarget(accountId, "KEYWORD"),
    ...latestSuggestionsByTarget(accountId, "PRODUCT_TARGET"),
  ]);
  const targets = tgtMeta.map((m) => {
    const a = tgtAgg.get(m.targetId) ?? { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 };
    return {
      targetId: m.targetId,
      adGroupId: m.adGroupId,
      campaignId: m.campaignId,
      program: m.program,
      kind: m.kind,
      matchType: m.matchType,
      display: m.display,
      state: m.state,
      bid: m.bid,
      m7d: bundle(a.spend, a.sales, a.orders, a.clicks, a.impressions),
      suggestion: sug.get(m.targetId) ?? null,
    };
  });

  return {
    adGroup: {
      adGroupId: agMeta.adGroupId,
      name: agMeta.name,
      campaignId: agMeta.campaignId,
      program: agMeta.program,
      state: agMeta.state,
      defaultBid: agMeta.defaultBid,
      m7d: bundle(agAgg.spend, agAgg.sales, agAgg.orders, agAgg.clicks, agAgg.impressions),
    },
    targets,
    range: r7,
  };
}

// ─── Latest-suggestion lookup ───────────────────────────────────────────────

interface SuggestionLite {
  id: string;
  bucket: string | null;
  actionType: string;
  actionValue: number | null;
  overrideValue: number | null;
  currentValue: number | null;
  reason: string;
  status: string;
  confidence: number | null;
  reviewer: string | null;
  createdAt: string;
  appliedAt: string | null;
}

function latestSuggestionsByTarget(accountId: string, targetType: string): Map<string, SuggestionLite> {
  // Window: 30 days back. Older recommendations are stale and not worth
  // showing inline — outcomes panel handles the long tail.
  const rows = getDb().prepare(`
    SELECT id, target_id, bucket, action_type, action_value, override_value, current_value,
           reason, status, confidence, reviewer, created_at, applied_at
    FROM suggestions
    WHERE account_id = ? AND target_type = ?
      AND created_at >= datetime('now', '-30 days')
    ORDER BY created_at DESC
  `).all(accountId, targetType) as Array<{
    id: string; target_id: string; bucket: string | null;
    action_type: string; action_value: number | null; override_value: number | null;
    current_value: number | null; reason: string; status: string; confidence: number | null;
    reviewer: string | null; created_at: string; applied_at: string | null;
  }>;

  const map = new Map<string, SuggestionLite>();
  for (const r of rows) {
    if (map.has(r.target_id)) continue; // keep most recent only
    map.set(r.target_id, {
      id: r.id,
      bucket: r.bucket,
      actionType: r.action_type,
      actionValue: r.action_value,
      overrideValue: r.override_value,
      currentValue: r.current_value,
      reason: r.reason,
      status: r.status,
      confidence: r.confidence,
      reviewer: r.reviewer,
      createdAt: r.created_at,
      appliedAt: r.applied_at,
    });
  }
  return map;
}
