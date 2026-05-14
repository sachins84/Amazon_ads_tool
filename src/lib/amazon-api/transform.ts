/**
 * Transforms raw Amazon Ads API report rows into the app's internal types.
 */
import type { CampaignRow, Target, TargetType, MatchType, TargetStatus } from "@/lib/types";
import type { SPCampaign } from "./campaigns";
import type { SPKeyword, SPProductTarget } from "./targeting";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeDiv(a: number, b: number, digits = 2): number {
  if (!b) return 0;
  return Math.round((a / b) * Math.pow(10, digits + 2)) / Math.pow(10, digits);
}

function toState(s: string): TargetStatus {
  if (s === "enabled") return "ENABLED";
  if (s === "paused") return "PAUSED";
  return "ARCHIVED";
}

// ─── Campaign merge ───────────────────────────────────────────────────────────

interface CampaignMetrics {
  campaignId: string;
  campaignName: string;
  impressions: number;
  clicks: number;
  cost: number;
  purchases30d: number;
  sales30d: number;
}

// mergeCampaigns() removed — the new /api/overview builds CampaignRows directly
// from UnifiedCampaign + UnifiedCampaignRow in src/app/api/overview/route.ts.

// ─── Targeting merge ─────────────────────────────────────────────────────────

interface TargetMetrics {
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
}

export function mergeKeywordTargets(
  keywords: SPKeyword[],
  metrics: TargetMetrics[],
  adGroupMap: Map<number, string>
): Target[] {
  const metricsMap = new Map(
    metrics
      .filter((m) => m.keywordId)
      .map((m) => [String(m.keywordId), m])
  );

  return keywords.map((kw): Target => {
    const m = metricsMap.get(String(kw.keywordId));
    const spend   = m?.cost ?? 0;
    const revenue = m?.sales30d ?? 0;
    const clicks  = m?.clicks ?? 0;
    const orders  = m?.purchases30d ?? 0;
    const impr    = m?.impressions ?? 0;

    const matchTypeMap: Record<string, MatchType> = {
      exact: "EXACT", phrase: "PHRASE", broad: "BROAD",
    };

    return {
      id:           String(kw.keywordId),
      value:        kw.keywordText,
      type:         "KEYWORD",
      matchType:    matchTypeMap[kw.matchType] ?? "EXACT",
      campaignId:   String(kw.campaignId),
      campaignName: m?.campaignName ?? `Campaign ${kw.campaignId}`,
      adGroupId:    String(kw.adGroupId),
      adGroupName:  adGroupMap.get(kw.adGroupId) ?? `Ad Group ${kw.adGroupId}`,
      status:       toState(kw.state),
      bid:          kw.bid ?? 0,
      suggestedBid: kw.bid ?? 0,
      impressions:  impr,
      clicks,
      ctr:          safeDiv(clicks, impr),
      spend:        Math.round(spend * 100) / 100,
      orders,
      revenue:      Math.round(revenue * 100) / 100,
      acos:         safeDiv(spend, revenue, 1),
      roas:         safeDiv(revenue, spend),
      cpc:          safeDiv(spend, clicks),
      cvr:          safeDiv(orders, clicks),
      trend7d:      [],
    };
  });
}

export function mergeProductTargets(
  targets: SPProductTarget[],
  metrics: TargetMetrics[],
  adGroupMap: Map<number, string>
): Target[] {
  const metricsMap = new Map(
    metrics
      .filter((m) => m.targetId)
      .map((m) => [String(m.targetId), m])
  );

  return targets.map((tgt): Target => {
    const m = metricsMap.get(String(tgt.targetId));
    const spend   = m?.cost ?? 0;
    const revenue = m?.sales30d ?? 0;
    const clicks  = m?.clicks ?? 0;
    const orders  = m?.purchases30d ?? 0;
    const impr    = m?.impressions ?? 0;

    // Determine if ASIN target or category
    const expr  = tgt.expression?.[0];
    const isAsin = expr?.type === "asinSameAs";
    const type: TargetType = tgt.expressionType === "auto" ? "AUTO" : isAsin ? "ASIN" : "CATEGORY";
    const value = expr?.value ?? "Auto Target";

    return {
      id:           String(tgt.targetId),
      value,
      type,
      matchType:    "AUTO",
      campaignId:   String(tgt.campaignId),
      campaignName: m?.campaignName ?? `Campaign ${tgt.campaignId}`,
      adGroupId:    String(tgt.adGroupId),
      adGroupName:  adGroupMap.get(tgt.adGroupId) ?? `Ad Group ${tgt.adGroupId}`,
      status:       toState(tgt.state),
      bid:          tgt.bid ?? 0,
      suggestedBid: tgt.bid ?? 0,
      impressions:  impr,
      clicks,
      ctr:          safeDiv(clicks, impr),
      spend:        Math.round(spend * 100) / 100,
      orders,
      revenue:      Math.round(revenue * 100) / 100,
      acos:         safeDiv(spend, revenue, 1),
      roas:         safeDiv(revenue, spend),
      cpc:          safeDiv(spend, clicks),
      cvr:          safeDiv(orders, clicks),
      trend7d:      [],
    };
  });
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

export function dateRangeFromPreset(preset: string): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date();

  const fmt = (d: Date) => d.toISOString().split("T")[0];

  switch (preset) {
    case "Today":       start.setDate(end.getDate()); break;
    case "Yesterday":   start.setDate(end.getDate() - 1); end.setDate(end.getDate() - 1); break;
    case "Last 7D":     start.setDate(end.getDate() - 7); break;
    case "Last 14D":    start.setDate(end.getDate() - 14); break;
    case "Last 30D":    start.setDate(end.getDate() - 30); break;
    case "This Month":  start.setDate(1); break;
    case "Last Month":  start.setMonth(start.getMonth() - 1, 1); end.setDate(0); break;
    default:            start.setDate(end.getDate() - 30);
  }

  return { startDate: fmt(start), endDate: fmt(end) };
}
