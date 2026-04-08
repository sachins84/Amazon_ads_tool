import { amazonRequest } from "./client";

// ─── Keyword targets (SP) ────────────────────────────────────────────────────

export interface SPKeyword {
  keywordId: number;
  adGroupId: number;
  campaignId: number;
  keywordText: string;
  matchType: "exact" | "phrase" | "broad";
  state: "enabled" | "paused" | "archived";
  bid?: number;
}

export interface SPKeywordUpdate {
  keywordId: number;
  state?: "enabled" | "paused" | "archived";
  bid?: number;
}

export async function listSPKeywords(profileId: string, accountId?: string): Promise<SPKeyword[]> {
  return amazonRequest<SPKeyword[]>("/sp/keywords?stateFilter=enabled,paused", { profileId, accountId });
}

export async function updateSPKeywords(
  profileId: string,
  updates: SPKeywordUpdate[],
  accountId?: string
): Promise<void> {
  await amazonRequest("/sp/keywords", { profileId, accountId, method: "PUT", body: updates });
}

export async function createSPKeywords(
  profileId: string,
  keywords: Omit<SPKeyword, "keywordId">[],
  accountId?: string
): Promise<void> {
  await amazonRequest("/sp/keywords", { profileId, accountId, method: "POST", body: keywords });
}

// ─── Product / ASIN targets (SP) ─────────────────────────────────────────────

export interface SPProductTarget {
  targetId: number;
  adGroupId: number;
  campaignId: number;
  state: "enabled" | "paused" | "archived";
  bid?: number;
  expression: Array<{ type: string; value?: string }>;
  expressionType: "manual" | "auto";
}

export interface SPProductTargetUpdate {
  targetId: number;
  state?: "enabled" | "paused" | "archived";
  bid?: number;
}

export async function listSPProductTargets(profileId: string, accountId?: string): Promise<SPProductTarget[]> {
  return amazonRequest<SPProductTarget[]>(
    "/sp/targets?stateFilter=enabled,paused",
    { profileId, accountId }
  );
}

export async function updateSPProductTargets(
  profileId: string,
  updates: SPProductTargetUpdate[],
  accountId?: string
): Promise<void> {
  await amazonRequest("/sp/targets", { profileId, accountId, method: "PUT", body: updates });
}

// ─── Negative keywords (SP) ──────────────────────────────────────────────────

export interface SPNegativeKeyword {
  keywordId?: number;
  adGroupId?: number;
  campaignId: number;
  keywordText: string;
  matchType: "negativeExact" | "negativePhrase";
  state: "enabled";
}

export async function createSPNegativeKeywords(
  profileId: string,
  keywords: Omit<SPNegativeKeyword, "keywordId">[],
  accountId?: string
): Promise<void> {
  await amazonRequest("/sp/negativeKeywords", { profileId, accountId, method: "POST", body: keywords });
}

// ─── Suggested bids ──────────────────────────────────────────────────────────

export interface SuggestedBidResult {
  keywordId: number;
  suggestedBid: {
    rangeStart: number;
    rangeEnd: number;
    suggested: number;
  };
}

export async function getSuggestedBids(
  profileId: string,
  keywordIds: number[],
  accountId?: string
): Promise<SuggestedBidResult[]> {
  return amazonRequest<SuggestedBidResult[]>("/sp/keywords/suggestedBid/batchGet", {
    profileId,
    accountId,
    method: "POST",
    body: { keywords: keywordIds.map((id) => ({ keywordId: id })) },
  });
}
