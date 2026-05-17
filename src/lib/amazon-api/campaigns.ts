/**
 * Campaign list/update wrappers across SP (v3), SB (v4), SD (v2 — still active).
 */
import { amazonRequest } from "./client";
import type { Program } from "./reports";

// ─── Per-program types ───────────────────────────────────────────────────────

export interface SPCampaign {
  campaignId: string;
  name: string;
  state: "ENABLED" | "PAUSED" | "ARCHIVED";
  budget: { budget: number; budgetType: "DAILY" };
  startDate?: string;
  endDate?: string;
  targetingType: "MANUAL" | "AUTO";
  portfolioId?: string;
  dynamicBidding?: {
    strategy: string;
    placementBidding: { placement: string; percentage: number }[];
  };
}

export interface SBCampaign {
  campaignId: string;
  name: string;
  state: "ENABLED" | "PAUSED" | "ARCHIVED";
  budget: number;
  budgetType: "DAILY" | "LIFETIME";
  startDate?: string;
  endDate?: string;
  portfolioId?: string;
  brandEntityId?: string;
  goal?: string;
  costType?: string;
}

export interface SDCampaign {
  campaignId: number;
  name: string;
  state: "enabled" | "paused" | "archived";
  tactic?: string;
  budget: number;
  budgetType: string;
  startDate?: string;
  endDate?: string;
  portfolioId?: number;
}

// Unified shape returned by listAllCampaigns().
export interface UnifiedCampaign {
  program:        Program;
  campaignId:     string;
  name:           string;
  state:          "ENABLED" | "PAUSED" | "ARCHIVED";
  dailyBudget:    number;
  startDate?:     string;
  endDate?:       string;
  portfolioId?:   string;
  brandEntityId?: string;
  /** SP only: MANUAL or AUTO targeting */
  targetingType?: "MANUAL" | "AUTO";
  /** STANDARD or VIDEO. Detected from name on SB; always STANDARD elsewhere.
   *  Lets the optimizer treat SB-Video as its own program. */
  format:         "STANDARD" | "VIDEO";
}

/** Detect a Sponsored Brands Video campaign from its name. SB v4 doesn't
 *  expose creative type at the campaign level, so we rely on naming tokens
 *  Mosaic uses: SBV, SBVid, Video, Vid. Conservative — only matches whole
 *  tokens separated by _, -, |, or space. */
export function isSBVideoName(name: string): boolean {
  return /(?:^|[_ \-|])(?:SBV|SBVid|Video|Vid)(?:[_ \-|]|$)/i.test(name);
}

// ─── SP v3 ───────────────────────────────────────────────────────────────────

const SP_CONTENT = "application/vnd.spCampaign.v3+json";

export async function listSPCampaigns(profileId: string, accountId?: string): Promise<SPCampaign[]> {
  const all: SPCampaign[] = [];
  let nextToken: string | undefined;
  do {
    const body: Record<string, unknown> = {
      maxResults: 500,
      stateFilter: { include: ["ENABLED", "PAUSED"] },
    };
    if (nextToken) body.nextToken = nextToken;

    const res = await amazonRequest<{ campaigns: SPCampaign[]; nextToken?: string }>("/sp/campaigns/list", {
      profileId, accountId, method: "POST", body,
      headers: { "Content-Type": SP_CONTENT, "Accept": SP_CONTENT },
    });
    all.push(...(res.campaigns ?? []));
    nextToken = res.nextToken;
  } while (nextToken);
  return all;
}

export interface SPCreateCampaign {
  name: string;
  budget: { budget: number; budgetType: "DAILY"; budgetCap?: { policy: "MONTHLY"; amount?: number } };
  startDate: string;
  endDate?: string;
  state: "ENABLED" | "PAUSED";
  targetingType: "MANUAL" | "AUTO";
  portfolioId?: string;
  dynamicBidding?: {
    strategy: "LEGACY_FOR_SALES" | "AUTO_FOR_SALES" | "MANUAL" | "RULE_BASED";
    placementBidding?: { placement: "PLACEMENT_TOP" | "PLACEMENT_PRODUCT_PAGE" | "PLACEMENT_REST_OF_SEARCH"; percentage: number }[];
  };
}

export async function createSPCampaigns(
  profileId: string,
  campaigns: SPCreateCampaign[],
  accountId?: string,
): Promise<{ campaigns: { success?: { index: number; campaignId: string }[]; error?: { errors: { message: string }[]; index: number }[] } }> {
  return amazonRequest("/sp/campaigns", {
    profileId, accountId, method: "POST",
    body: { campaigns },
    headers: { "Content-Type": SP_CONTENT, "Accept": SP_CONTENT },
  });
}

export async function updateSPCampaigns(
  profileId: string,
  updates: { campaignId: string; state?: "ENABLED" | "PAUSED"; budget?: { budget: number; budgetType: "DAILY" }; name?: string }[],
  accountId?: string,
): Promise<unknown> {
  return amazonRequest("/sp/campaigns", {
    profileId, accountId, method: "PUT",
    body: { campaigns: updates },
    headers: { "Content-Type": SP_CONTENT, "Accept": SP_CONTENT },
  });
}

// ─── SB v4 ───────────────────────────────────────────────────────────────────

const SB_CONTENT = "application/vnd.sbcampaignresource.v4+json";

export async function listSBCampaigns(profileId: string, accountId?: string): Promise<SBCampaign[]> {
  const all: SBCampaign[] = [];
  let nextToken: string | undefined;
  do {
    const body: Record<string, unknown> = {
      maxResults: 100, // SB v4 caps at 100
      stateFilter: { include: ["ENABLED", "PAUSED"] },
    };
    if (nextToken) body.nextToken = nextToken;

    const res = await amazonRequest<{ campaigns: SBCampaign[]; nextToken?: string }>("/sb/v4/campaigns/list", {
      profileId, accountId, method: "POST", body,
      headers: { "Content-Type": SB_CONTENT, "Accept": SB_CONTENT },
    });
    all.push(...(res.campaigns ?? []));
    nextToken = res.nextToken;
  } while (nextToken);
  return all;
}

export async function updateSBCampaigns(
  profileId: string,
  updates: { campaignId: string; state?: "ENABLED" | "PAUSED"; budget?: number; name?: string }[],
  accountId?: string,
): Promise<unknown> {
  return amazonRequest("/sb/v4/campaigns", {
    profileId, accountId, method: "PUT",
    body: { campaigns: updates },
    headers: { "Content-Type": SB_CONTENT, "Accept": SB_CONTENT },
  });
}

// ─── SD (still v2-style endpoints) ───────────────────────────────────────────

export async function listSDCampaigns(profileId: string, accountId?: string): Promise<SDCampaign[]> {
  return amazonRequest<SDCampaign[]>("/sd/campaigns?stateFilter=enabled,paused", { profileId, accountId });
}

export async function updateSDCampaigns(
  profileId: string,
  updates: { campaignId: number; state?: "enabled" | "paused"; budget?: number; name?: string }[],
  accountId?: string,
): Promise<unknown> {
  return amazonRequest("/sd/campaigns", {
    profileId, accountId, method: "PUT", body: updates,
  });
}

// ─── Unified listing across all 3 programs ───────────────────────────────────

export async function listAllCampaigns(
  profileId: string, accountId?: string,
): Promise<{ campaigns: UnifiedCampaign[]; errors: { program: Program; error: string }[] }> {
  const results = await Promise.allSettled([
    listSPCampaigns(profileId, accountId),
    listSBCampaigns(profileId, accountId),
    listSDCampaigns(profileId, accountId),
  ]);

  const campaigns: UnifiedCampaign[] = [];
  const errors: { program: Program; error: string }[] = [];
  const programs: Program[] = ["SP", "SB", "SD"];

  results.forEach((res, i) => {
    const program = programs[i];
    if (res.status === "rejected") {
      errors.push({ program, error: String(res.reason) });
      return;
    }
    if (program === "SP") {
      for (const c of res.value as SPCampaign[]) {
        campaigns.push({
          program,
          campaignId:    String(c.campaignId),
          name:          c.name,
          state:         c.state,
          dailyBudget:   c.budget?.budget ?? 0,
          startDate:     c.startDate,
          endDate:       c.endDate,
          portfolioId:   c.portfolioId,
          targetingType: c.targetingType,
          format:        "STANDARD",
        });
      }
    } else if (program === "SB") {
      for (const c of res.value as SBCampaign[]) {
        campaigns.push({
          program,
          campaignId:    String(c.campaignId),
          name:          c.name,
          state:         c.state,
          dailyBudget:   c.budgetType === "DAILY" ? (c.budget ?? 0) : 0,
          startDate:     c.startDate,
          endDate:       c.endDate,
          portfolioId:   c.portfolioId,
          brandEntityId: c.brandEntityId,
          format:        isSBVideoName(c.name) ? "VIDEO" : "STANDARD",
        });
      }
    } else if (program === "SD") {
      for (const c of res.value as SDCampaign[]) {
        const state = c.state === "enabled" ? "ENABLED" : c.state === "paused" ? "PAUSED" : "ARCHIVED";
        campaigns.push({
          program,
          campaignId:  String(c.campaignId),
          name:        c.name,
          state,
          dailyBudget: c.budget ?? 0,
          startDate:   c.startDate,
          endDate:     c.endDate,
          portfolioId: c.portfolioId != null ? String(c.portfolioId) : undefined,
          format:      "STANDARD",
        });
      }
    }
  });

  return { campaigns, errors };
}
