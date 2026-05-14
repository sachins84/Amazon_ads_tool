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
