/**
 * Ad-group list wrappers across SP (v3), SB (v4), SD (v2-style).
 */
import { amazonRequest } from "./client";
import type { Program } from "./reports";

// ─── Per-program types ───────────────────────────────────────────────────────

export interface SPAdGroup {
  adGroupId:  string;
  campaignId: string;
  name:       string;
  state:      "ENABLED" | "PAUSED" | "ARCHIVED";
  defaultBid: number;
}

export interface SBAdGroup {
  adGroupId:  string;
  campaignId: string;
  name:       string;
  state:      "ENABLED" | "PAUSED" | "ARCHIVED";
}

export interface SDAdGroup {
  adGroupId:  number;
  campaignId: number;
  name:       string;
  state:      "enabled" | "paused" | "archived";
  defaultBid?: number;
}

export interface UnifiedAdGroup {
  program:    Program;
  adGroupId:  string;
  campaignId: string;
  name:       string;
  state:      "ENABLED" | "PAUSED" | "ARCHIVED";
  defaultBid: number;
}

// ─── SP v3 ───────────────────────────────────────────────────────────────────

const SP_AG_CONTENT = "application/vnd.spAdGroup.v3+json";

export async function listSPAdGroups(
  profileId: string,
  accountId?: string,
  filter: { campaignIdFilter?: string[] } = {},
): Promise<SPAdGroup[]> {
  const all: SPAdGroup[] = [];
  let nextToken: string | undefined;
  do {
    const body: Record<string, unknown> = {
      maxResults: 500,
      stateFilter: { include: ["ENABLED", "PAUSED"] },
    };
    if (filter.campaignIdFilter?.length) body.campaignIdFilter = { include: filter.campaignIdFilter };
    if (nextToken) body.nextToken = nextToken;

    const res = await amazonRequest<{ adGroups: SPAdGroup[]; nextToken?: string }>("/sp/adGroups/list", {
      profileId, accountId, method: "POST", body,
      headers: { "Content-Type": SP_AG_CONTENT, "Accept": SP_AG_CONTENT },
    });
    all.push(...(res.adGroups ?? []));
    nextToken = res.nextToken;
  } while (nextToken);
  return all;
}

// ─── SB v4 ───────────────────────────────────────────────────────────────────

const SB_AG_CONTENT = "application/vnd.sbadgroupresource.v4+json";

export async function listSBAdGroups(
  profileId: string,
  accountId?: string,
  filter: { campaignIdFilter?: string[] } = {},
): Promise<SBAdGroup[]> {
  const all: SBAdGroup[] = [];
  let nextToken: string | undefined;
  do {
    const body: Record<string, unknown> = {
      maxResults: 100, // SB v4 caps at 100
      stateFilter: { include: ["ENABLED", "PAUSED"] },
    };
    if (filter.campaignIdFilter?.length) body.campaignIdFilter = { include: filter.campaignIdFilter };
    if (nextToken) body.nextToken = nextToken;

    const res = await amazonRequest<{ adGroups: SBAdGroup[]; nextToken?: string }>("/sb/v4/adGroups/list", {
      profileId, accountId, method: "POST", body,
      headers: { "Content-Type": SB_AG_CONTENT, "Accept": SB_AG_CONTENT },
    });
    all.push(...(res.adGroups ?? []));
    nextToken = res.nextToken;
  } while (nextToken);
  return all;
}

// ─── SD ──────────────────────────────────────────────────────────────────────

export async function listSDAdGroups(
  profileId: string,
  accountId?: string,
): Promise<SDAdGroup[]> {
  return amazonRequest<SDAdGroup[]>("/sd/adGroups?stateFilter=enabled,paused", { profileId, accountId });
}

// ─── Unified ─────────────────────────────────────────────────────────────────

export async function listAllAdGroups(
  profileId: string,
  campaignIds: string[] | undefined,
  accountId?: string,
): Promise<{ adGroups: UnifiedAdGroup[]; errors: { program: Program; error: string }[] }> {
  const results = await Promise.allSettled([
    listSPAdGroups(profileId, accountId, { campaignIdFilter: campaignIds }),
    listSBAdGroups(profileId, accountId, { campaignIdFilter: campaignIds }),
    listSDAdGroups(profileId, accountId), // SD endpoint doesn't accept campaign filter in v2 path
  ]);

  const adGroups: UnifiedAdGroup[] = [];
  const errors: { program: Program; error: string }[] = [];
  const programs: Program[] = ["SP", "SB", "SD"];

  results.forEach((res, i) => {
    const program = programs[i];
    if (res.status === "rejected") {
      errors.push({ program, error: String(res.reason) });
      return;
    }
    if (program === "SP") {
      for (const ag of res.value as SPAdGroup[]) {
        adGroups.push({
          program, adGroupId: String(ag.adGroupId), campaignId: String(ag.campaignId),
          name: ag.name, state: ag.state, defaultBid: ag.defaultBid ?? 0,
        });
      }
    } else if (program === "SB") {
      for (const ag of res.value as SBAdGroup[]) {
        adGroups.push({
          program, adGroupId: String(ag.adGroupId), campaignId: String(ag.campaignId),
          name: ag.name, state: ag.state, defaultBid: 0,
        });
      }
    } else if (program === "SD") {
      for (const ag of res.value as SDAdGroup[]) {
        const state = ag.state === "enabled" ? "ENABLED" : ag.state === "paused" ? "PAUSED" : "ARCHIVED";
        // For SD we filter client-side by campaign ID since the GET endpoint doesn't take that filter.
        if (campaignIds && !campaignIds.includes(String(ag.campaignId))) continue;
        adGroups.push({
          program, adGroupId: String(ag.adGroupId), campaignId: String(ag.campaignId),
          name: ag.name, state, defaultBid: ag.defaultBid ?? 0,
        });
      }
    }
  });

  return { adGroups, errors };
}

// ─── Updates ─────────────────────────────────────────────────────────────────

export async function updateSPAdGroups(
  profileId: string,
  updates: { adGroupId: string; state?: "ENABLED" | "PAUSED"; defaultBid?: number; name?: string }[],
  accountId?: string,
): Promise<unknown> {
  return amazonRequest("/sp/adGroups", {
    profileId, accountId, method: "PUT",
    body: { adGroups: updates },
    headers: { "Content-Type": SP_AG_CONTENT, "Accept": SP_AG_CONTENT },
  });
}
