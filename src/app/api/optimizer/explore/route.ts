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
import { countNotesByTarget } from "@/lib/db/notes-repo";

type BucketCounts = Partial<Record<"SCALE_UP" | "SCALE_DOWN" | "PAUSE" | "BID_UP" | "BID_DOWN" | "HOLD", number>>;

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
  const childBuckets = childBucketsByCampaign(accountId);
  const notes = countNotesByTarget(accountId);
  const { ai: aiSug, manual: manualSug } = sug;

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
      aiSuggestion:     aiSug.get(m.campaignId) ?? null,
      manualSuggestion: manualSug.get(m.campaignId) ?? null,
      childBuckets: childBuckets.get(m.campaignId) ?? {},
      notesCount: notes.get(`CAMPAIGN|${m.campaignId}`) ?? 0,
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
  const { ai: aiSug, manual: manualSug } = sug;
  const childBuckets = childBucketsByAdGroup(accountId, campaignId);
  const notes = countNotesByTarget(accountId);
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
      aiSuggestion:     aiSug.get(m.adGroupId) ?? null,
      manualSuggestion: manualSug.get(m.adGroupId) ?? null,
      childBuckets: childBuckets.get(m.adGroupId) ?? {},
      notesCount: notes.get(`AD_GROUP|${m.adGroupId}`) ?? 0,
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

  const kwSug = latestSuggestionsByTarget(accountId, "KEYWORD");
  const patSug = latestSuggestionsByTarget(accountId, "PRODUCT_TARGET");
  const aiSug     = new Map([...kwSug.ai, ...patSug.ai]);
  const manualSug = new Map([...kwSug.manual, ...patSug.manual]);
  const notes = countNotesByTarget(accountId);
  const targets = tgtMeta.map((m) => {
    const a = tgtAgg.get(m.targetId) ?? { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 };
    const noteKey = m.kind === "KEYWORD" ? "KEYWORD" : "PRODUCT_TARGET";
    return {
      targetId: m.targetId,
      adGroupId: m.adGroupId,
      campaignId: m.campaignId,
      notesCount: notes.get(`${noteKey}|${m.targetId}`) ?? 0,
      program: m.program,
      kind: m.kind,
      matchType: m.matchType,
      display: m.display,
      state: m.state,
      bid: m.bid,
      m7d: bundle(a.spend, a.sales, a.orders, a.clicks, a.impressions),
      aiSuggestion:     aiSug.get(m.targetId) ?? null,
      manualSuggestion: manualSug.get(m.targetId) ?? null,
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

/**
 * For every campaign on the account, count PENDING-suggestion buckets nested
 * inside it (across ad-groups, keywords, product targets — using the
 * suggestion rows' target_type + a join up through ad-group/target metadata
 * back to campaign_id). Lets the UI badge a campaign with "+5 BID_DOWN
 * inside" even when the campaign-level suggestion is HOLD/null, so filtering
 * by BID_UP/BID_DOWN doesn't return an empty list at the top level.
 */
function childBucketsByCampaign(accountId: string): Map<string, BucketCounts> {
  const rows = getDb().prepare(`
    SELECT campaign_id, bucket, n FROM (
      -- Direct ad-group suggestions
      SELECT ag.campaign_id, s.bucket, COUNT(*) AS n
      FROM suggestions s
      JOIN adgroup_meta ag ON ag.account_id = s.account_id AND ag.adgroup_id = s.target_id
      WHERE s.account_id = ?
        AND s.status = 'PENDING'
        AND s.target_type = 'AD_GROUP'
        AND s.bucket IS NOT NULL
      GROUP BY ag.campaign_id, s.bucket

      UNION ALL

      -- Keyword + product-target suggestions, joined to campaign via targeting_meta
      SELECT tm.campaign_id, s.bucket, COUNT(*) AS n
      FROM suggestions s
      JOIN targeting_meta tm ON tm.account_id = s.account_id AND tm.target_id = s.target_id
      WHERE s.account_id = ?
        AND s.status = 'PENDING'
        AND s.target_type IN ('KEYWORD','PRODUCT_TARGET')
        AND s.bucket IS NOT NULL
      GROUP BY tm.campaign_id, s.bucket
    )
  `).all(accountId, accountId) as Array<{ campaign_id: string; bucket: string; n: number }>;

  const out = new Map<string, BucketCounts>();
  for (const r of rows) {
    const cur = out.get(r.campaign_id) ?? {};
    cur[r.bucket as keyof BucketCounts] = (cur[r.bucket as keyof BucketCounts] ?? 0) + r.n;
    out.set(r.campaign_id, cur);
  }
  return out;
}

/** Same idea, scoped to a single campaign — rolls KW/target buckets up to ad-group. */
function childBucketsByAdGroup(accountId: string, campaignId: string): Map<string, BucketCounts> {
  const rows = getDb().prepare(`
    SELECT tm.adgroup_id, s.bucket, COUNT(*) AS n
    FROM suggestions s
    JOIN targeting_meta tm ON tm.account_id = s.account_id AND tm.target_id = s.target_id
    WHERE s.account_id = ?
      AND tm.campaign_id = ?
      AND s.status = 'PENDING'
      AND s.target_type IN ('KEYWORD','PRODUCT_TARGET')
      AND s.bucket IS NOT NULL
    GROUP BY tm.adgroup_id, s.bucket
  `).all(accountId, campaignId) as Array<{ adgroup_id: string; bucket: string; n: number }>;

  const out = new Map<string, BucketCounts>();
  for (const r of rows) {
    const cur = out.get(r.adgroup_id) ?? {};
    cur[r.bucket as keyof BucketCounts] = (cur[r.bucket as keyof BucketCounts] ?? 0) + r.n;
    out.set(r.adgroup_id, cur);
  }
  return out;
}

/** Suggestion source — derived from the rule that owns the suggestion. */
const AI_RULE_NAME = "AI Optimizer";

interface SuggestionsByTarget {
  ai:     Map<string, SuggestionLite>;
  manual: Map<string, SuggestionLite>;
}

/**
 * Returns the most recent PENDING suggestion per (target_id) from EACH
 * source (AI Optimizer vs manual rules), so the UI can show both pills
 * side-by-side. Joins to rules so we can tell which is which without a
 * schema migration.
 */
function latestSuggestionsByTarget(accountId: string, targetType: string): SuggestionsByTarget {
  const rows = getDb().prepare(`
    SELECT s.id, s.target_id, s.bucket, s.action_type, s.action_value,
           s.override_value, s.current_value, s.reason, s.status, s.confidence,
           s.reviewer, s.created_at, s.applied_at,
           CASE WHEN r.name = ? THEN 'AI' ELSE 'MANUAL' END AS source
    FROM suggestions s
    LEFT JOIN rules r ON r.id = s.rule_id
    WHERE s.account_id = ? AND s.target_type = ?
      AND s.created_at >= datetime('now', '-30 days')
    ORDER BY s.created_at DESC
  `).all(AI_RULE_NAME, accountId, targetType) as Array<{
    id: string; target_id: string; bucket: string | null;
    action_type: string; action_value: number | null; override_value: number | null;
    current_value: number | null; reason: string; status: string; confidence: number | null;
    reviewer: string | null; created_at: string; applied_at: string | null;
    source: "AI" | "MANUAL";
  }>;

  const ai     = new Map<string, SuggestionLite>();
  const manual = new Map<string, SuggestionLite>();
  for (const r of rows) {
    const bucket = r.source === "AI" ? ai : manual;
    if (bucket.has(r.target_id)) continue; // keep most recent only per source
    bucket.set(r.target_id, {
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
  return { ai, manual };
}
