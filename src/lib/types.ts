export type CampaignType = "SP" | "SB" | "SD";
export type TargetType = "KEYWORD" | "ASIN" | "CATEGORY" | "AUTO";
export type MatchType = "EXACT" | "PHRASE" | "BROAD" | "AUTO";
export type TargetStatus = "ENABLED" | "PAUSED" | "ARCHIVED";

export interface MetricWithDelta {
  value: number;
  delta: number;
  positive: boolean; // true = green, false = red
}

export interface OverviewKpis {
  spend: MetricWithDelta;
  revenue: MetricWithDelta;
  acos: MetricWithDelta;
  roas: MetricWithDelta;
  orders: MetricWithDelta;
  impressions: MetricWithDelta;
  clicks: MetricWithDelta;
  ctr: MetricWithDelta;
  cpc: MetricWithDelta;
  cvr: MetricWithDelta;
  ntbOrders: MetricWithDelta;
  tacos: MetricWithDelta;
}

export interface TimeSeriesPoint {
  date: string;
  spend: number;
  revenue: number;
  acos: number;
}

export interface CampaignRow {
  id: string;
  name: string;
  type: CampaignType;
  status: "ENABLED" | "PAUSED";
  budget: number;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  orders: number;
  revenue: number;
  acos: number;
  roas: number;
  cvr: number;
}

export interface Target {
  id: string;
  value: string;
  type: TargetType;
  matchType: MatchType;
  campaignId: string;
  campaignName: string;
  adGroupId: string;
  adGroupName: string;
  status: TargetStatus;
  bid: number;
  suggestedBid: number;
  impressions: number;
  clicks: number;
  ctr: number;
  spend: number;
  orders: number;
  revenue: number;
  acos: number;
  roas: number;
  cpc: number;
  cvr: number;
  trend7d: number[];
}

export interface TargetingFilters {
  search: string;
  campaignIds: string[];
  adGroupIds: string[];
  targetType: TargetType | "ALL";
  matchType: MatchType | "ALL";
  status: TargetStatus | "ALL";
  bidMin: string;
  bidMax: string;
  acosMin: string;
  acosMax: string;
  spendMin: string;
}
