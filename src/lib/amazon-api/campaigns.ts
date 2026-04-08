import { amazonRequest } from "./client";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SPCampaign {
  campaignId: number;
  name: string;
  campaignType: "sponsoredProducts";
  targetingType: "manual" | "auto";
  state: "enabled" | "paused" | "archived";
  dailyBudget: number;
  startDate: string;
  endDate?: string;
}

export interface SBCampaign {
  campaignId: number;
  name: string;
  campaignType: "headlineSearch";
  state: "enabled" | "paused" | "archived";
  dailyBudget: number;
}

export interface SDCampaign {
  campaignId: number;
  name: string;
  state: "enabled" | "paused" | "archived";
  tactic: string;
  budget: number;
  budgetType: string;
}

// ─── API calls ────────────────────────────────────────────────────────────────

export async function listSPCampaigns(profileId: string, accountId?: string): Promise<SPCampaign[]> {
  return amazonRequest<SPCampaign[]>("/sp/campaigns?stateFilter=enabled,paused", { profileId, accountId });
}

export async function listSBCampaigns(profileId: string, accountId?: string): Promise<SBCampaign[]> {
  return amazonRequest<SBCampaign[]>("/sb/campaigns?stateFilter=enabled,paused", { profileId, accountId });
}

export async function listSDCampaigns(profileId: string, accountId?: string): Promise<SDCampaign[]> {
  return amazonRequest<SDCampaign[]>("/sd/campaigns?stateFilter=enabled,paused", { profileId, accountId });
}

export async function updateSPCampaign(
  profileId: string,
  campaignId: number,
  updates: Partial<Pick<SPCampaign, "state" | "dailyBudget" | "name">>,
  accountId?: string
): Promise<void> {
  await amazonRequest("/sp/campaigns", {
    profileId,
    accountId,
    method: "PUT",
    body: [{ campaignId, ...updates }],
  });
}
