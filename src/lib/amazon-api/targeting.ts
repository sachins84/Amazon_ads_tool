/**
 * SP keyword + product-target list/update helpers — v3 POST endpoints.
 *
 * (SB and SD have their own keyword/target equivalents; SP is wired here first
 * since it's where most automation lands.)
 */
import { amazonRequest } from "./client";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SPKeyword {
  keywordId:   string;
  adGroupId:   string;
  campaignId:  string;
  keywordText: string;
  matchType:   "EXACT" | "PHRASE" | "BROAD";
  state:       "ENABLED" | "PAUSED" | "ARCHIVED";
  bid?:        number;
}

export interface SPProductTarget {
  targetId:        string;
  adGroupId:       string;
  campaignId:      string;
  state:           "ENABLED" | "PAUSED" | "ARCHIVED";
  bid?:            number;
  expressionType?: "MANUAL" | "AUTO";
  expression?:     { type: string; value?: string }[];
  resolvedExpression?: { type: string; value?: string }[];
}

const KW_CONTENT  = "application/vnd.spKeyword.v3+json";
const TGT_CONTENT = "application/vnd.spTargetingClause.v3+json";

// ─── SP keywords ─────────────────────────────────────────────────────────────

export async function listSPKeywords(
  profileId: string,
  filter: { adGroupIdFilter?: string[]; campaignIdFilter?: string[] } = {},
  accountId?: string,
): Promise<SPKeyword[]> {
  const all: SPKeyword[] = [];
  let nextToken: string | undefined;
  do {
    const body: Record<string, unknown> = {
      maxResults: 500,
      stateFilter: { include: ["ENABLED", "PAUSED"] },
    };
    if (filter.adGroupIdFilter?.length)   body.adGroupIdFilter   = { include: filter.adGroupIdFilter };
    if (filter.campaignIdFilter?.length)  body.campaignIdFilter  = { include: filter.campaignIdFilter };
    if (nextToken) body.nextToken = nextToken;

    const res = await amazonRequest<{ keywords: SPKeyword[]; nextToken?: string }>("/sp/keywords/list", {
      profileId, accountId, method: "POST", body,
      headers: { "Content-Type": KW_CONTENT, "Accept": KW_CONTENT },
    });
    all.push(...(res.keywords ?? []));
    nextToken = res.nextToken;
  } while (nextToken);
  return all;
}

export async function updateSPKeywords(
  profileId: string,
  updates: { keywordId: string; state?: "ENABLED" | "PAUSED"; bid?: number }[],
  accountId?: string,
): Promise<unknown> {
  return amazonRequest("/sp/keywords", {
    profileId, accountId, method: "PUT",
    body: { keywords: updates },
    headers: { "Content-Type": KW_CONTENT, "Accept": KW_CONTENT },
  });
}

// ─── SP product targets ──────────────────────────────────────────────────────

export async function listSPProductTargets(
  profileId: string,
  filter: { adGroupIdFilter?: string[]; campaignIdFilter?: string[] } = {},
  accountId?: string,
): Promise<SPProductTarget[]> {
  const all: SPProductTarget[] = [];
  let nextToken: string | undefined;
  do {
    const body: Record<string, unknown> = {
      maxResults: 500,
      stateFilter: { include: ["ENABLED", "PAUSED"] },
    };
    if (filter.adGroupIdFilter?.length)  body.adGroupIdFilter  = { include: filter.adGroupIdFilter };
    if (filter.campaignIdFilter?.length) body.campaignIdFilter = { include: filter.campaignIdFilter };
    if (nextToken) body.nextToken = nextToken;

    const res = await amazonRequest<{ targetingClauses: SPProductTarget[]; nextToken?: string }>("/sp/targets/list", {
      profileId, accountId, method: "POST", body,
      headers: { "Content-Type": TGT_CONTENT, "Accept": TGT_CONTENT },
    });
    all.push(...(res.targetingClauses ?? []));
    nextToken = res.nextToken;
  } while (nextToken);
  return all;
}

export async function updateSPProductTargets(
  profileId: string,
  updates: { targetId: string; state?: "ENABLED" | "PAUSED"; bid?: number }[],
  accountId?: string,
): Promise<unknown> {
  return amazonRequest("/sp/targets", {
    profileId, accountId, method: "PUT",
    body: { targetingClauses: updates },
    headers: { "Content-Type": TGT_CONTENT, "Accept": TGT_CONTENT },
  });
}

// ─── Create-time helpers (product ads + keywords + targets) ─────────────────

const AD_CONTENT = "application/vnd.spProductAd.v3+json";

export interface SPCreateProductAd {
  campaignId: string;
  adGroupId: string;
  asin?: string;
  sku?: string;
  state: "ENABLED" | "PAUSED";
}

export async function createSPProductAds(
  profileId: string,
  productAds: SPCreateProductAd[],
  accountId?: string,
): Promise<unknown> {
  return amazonRequest("/sp/productAds", {
    profileId, accountId, method: "POST",
    body: { productAds },
    headers: { "Content-Type": AD_CONTENT, "Accept": AD_CONTENT },
  });
}

export interface SPCreateKeyword {
  campaignId: string;
  adGroupId: string;
  keywordText: string;
  matchType: "EXACT" | "PHRASE" | "BROAD";
  bid?: number;
  state: "ENABLED" | "PAUSED";
}

export async function createSPKeywords(
  profileId: string,
  keywords: SPCreateKeyword[],
  accountId?: string,
): Promise<unknown> {
  return amazonRequest("/sp/keywords", {
    profileId, accountId, method: "POST",
    body: { keywords },
    headers: { "Content-Type": KW_CONTENT, "Accept": KW_CONTENT },
  });
}

export interface SPCreateProductTarget {
  campaignId: string;
  adGroupId: string;
  expression: { type: string; value?: string }[];   // [{type:"asinSameAs", value:"B0..."}] OR category expression
  bid?: number;
  state: "ENABLED" | "PAUSED";
}

export async function createSPProductTargets(
  profileId: string,
  targets: SPCreateProductTarget[],
  accountId?: string,
): Promise<unknown> {
  return amazonRequest("/sp/targets", {
    profileId, accountId, method: "POST",
    body: { targetingClauses: targets.map((t) => ({
      campaignId: t.campaignId, adGroupId: t.adGroupId,
      expression: t.expression,
      expressionType: "MANUAL",
      bid: t.bid, state: t.state,
    })) },
    headers: { "Content-Type": TGT_CONTENT, "Accept": TGT_CONTENT },
  });
}

/** Auto-targeting expressions: queryHighRelMatches | queryBroadRelMatches |
 *  asinSubstituteRelated | asinAccessoryRelated. Each gets its own bid. */
export interface SPCreateAutoTarget {
  campaignId: string;
  adGroupId: string;
  type: "queryHighRelMatches" | "queryBroadRelMatches" | "asinSubstituteRelated" | "asinAccessoryRelated";
  bid?: number;
  state: "ENABLED" | "PAUSED";
}

export async function createSPAutoTargets(
  profileId: string,
  targets: SPCreateAutoTarget[],
  accountId?: string,
): Promise<unknown> {
  return amazonRequest("/sp/targets", {
    profileId, accountId, method: "POST",
    body: { targetingClauses: targets.map((t) => ({
      campaignId: t.campaignId, adGroupId: t.adGroupId,
      expression: [{ type: t.type }],
      expressionType: "AUTO",
      bid: t.bid, state: t.state,
    })) },
    headers: { "Content-Type": TGT_CONTENT, "Accept": TGT_CONTENT },
  });
}

// ─── Bid recommendations (Theme-Based Bid Recommendations v3) ───────────────
// POST /sp/targets/bid/recommendations returns suggested bid ranges
// (rangeStart / suggestedBid / rangeEnd) for one ad group's targets at a time.
// The response is themed (CONVERSION_OPPORTUNITIES etc.) — we just collapse
// every bid-value tuple per targeting expression and take the median across
// themes so each (target) ends up with one (low, median, high) tuple.

const BID_REC_CONTENT = "application/vnd.spthemebasedbidrecommendation.v3+json";

export interface BidRecommendation {
  /** Echoes our input so the caller can match back to a targetId. */
  expression: { type: string; value?: string }[];
  matchType?: "EXACT" | "PHRASE" | "BROAD";
  bidLow:    number | null;
  bidMedian: number | null;
  bidHigh:   number | null;
}

interface RawBidRecResponse {
  bidRecommendations?: Array<{
    theme?: string;
    bidRecommendationsForTargetingExpressions?: Array<{
      targetingExpression?: { type?: string; value?: string };
      bidValues?: Array<{ suggestedBid?: number; rangeStart?: number; rangeEnd?: number }>;
    }>;
  }>;
}

/**
 * Fetch suggested bids for a set of existing targeting expressions in one ad
 * group. `expressions` map matches the Amazon spec — type is e.g.
 * "KEYWORD_BROAD_MATCH" / "KEYWORD_EXACT_MATCH" / "KEYWORD_PHRASE_MATCH" or
 * "ASIN_SAME_AS" for product targets. Returns an entry per expression; values
 * may be null when Amazon has no recommendation for that target.
 *
 * Caller is expected to drive batching per ad group (Amazon caps at one
 * ad-group per request). On error we throw — the refresh-service layer catches
 * and degrades to "no recommendations" for that batch.
 */
export async function getSPBidRecommendations(
  profileId: string,
  args: {
    campaignId: string;
    adGroupId:  string;
    asins:      string[];
    expressions: { type: string; value?: string }[];
  },
  accountId?: string,
): Promise<BidRecommendation[]> {
  if (args.expressions.length === 0) return [];

  const body = {
    campaignId:       args.campaignId,
    adGroupId:        args.adGroupId,
    asins:            args.asins,
    targetingExpressions: args.expressions,
    recommendationType: "BIDS_FOR_EXISTING_AD_GROUP",
  };

  const res = await amazonRequest<RawBidRecResponse>("/sp/targets/bid/recommendations", {
    profileId, accountId, method: "POST", body,
    headers: { "Content-Type": BID_REC_CONTENT, "Accept": BID_REC_CONTENT },
  });

  // Index across themes: for each expression collapse to (min low, mean median, max high).
  const collapsed = new Map<string, { lows: number[]; meds: number[]; highs: number[]; type: string; value?: string }>();
  for (const theme of res.bidRecommendations ?? []) {
    for (const item of theme.bidRecommendationsForTargetingExpressions ?? []) {
      const expr = item.targetingExpression;
      if (!expr?.type) continue;
      const key = `${expr.type}::${expr.value ?? ""}`;
      const cur = collapsed.get(key) ?? { lows: [], meds: [], highs: [], type: expr.type, value: expr.value };
      for (const v of item.bidValues ?? []) {
        if (typeof v.rangeStart   === "number") cur.lows.push(v.rangeStart);
        if (typeof v.suggestedBid === "number") cur.meds.push(v.suggestedBid);
        if (typeof v.rangeEnd     === "number") cur.highs.push(v.rangeEnd);
      }
      collapsed.set(key, cur);
    }
  }

  return [...collapsed.values()].map((c) => ({
    expression: [{ type: c.type, value: c.value }],
    bidLow:    c.lows.length  ? Math.min(...c.lows)              : null,
    bidMedian: c.meds.length  ? c.meds.reduce((s, x) => s + x, 0) / c.meds.length : null,
    bidHigh:   c.highs.length ? Math.max(...c.highs)             : null,
  }));
}

// ─── Negative keywords ───────────────────────────────────────────────────────

const NEG_KW_CONTENT = "application/vnd.spNegativeKeyword.v3+json";

export async function createSPNegativeKeywords(
  profileId: string,
  keywords: { campaignId: string; adGroupId?: string; keywordText: string; matchType: "NEGATIVE_EXACT" | "NEGATIVE_PHRASE"; state: "ENABLED" }[],
  accountId?: string,
): Promise<unknown> {
  return amazonRequest("/sp/negativeKeywords", {
    profileId, accountId, method: "POST",
    body: { negativeKeywords: keywords },
    headers: { "Content-Type": NEG_KW_CONTENT, "Accept": NEG_KW_CONTENT },
  });
}
