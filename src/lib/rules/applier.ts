/**
 * Applies an APPROVED suggestion to Amazon by mapping action_type → the
 * appropriate v3 PUT endpoint. Returns a status the caller writes back to
 * the suggestion row.
 *
 * IMPORTANT: Amazon's update endpoints return HTTP 207 multi-status. The
 * per-item success/error must be inspected. A 2xx HTTP code does NOT mean
 * the change went through.
 */
import { getAccount } from "@/lib/db/accounts";
import { updateSPCampaigns, updateSBCampaigns, updateSDCampaigns } from "@/lib/amazon-api/campaigns";
import { updateSPAdGroups } from "@/lib/amazon-api/adgroups";
import { updateSPKeywords, updateSPProductTargets } from "@/lib/amazon-api/targeting";
import type { Suggestion } from "./types";

export interface ApplyResult {
  ok: boolean;
  message: string;
}

export async function applySuggestion(s: Suggestion): Promise<ApplyResult> {
  const acct = getAccount(s.accountId);
  if (!acct) return { ok: false, message: `account ${s.accountId} not found` };
  const profileId = acct.adsProfileId;

  try {
    let resp: unknown;

    if (s.targetType === "CAMPAIGN") {
      resp = await applyCampaign(profileId, s.accountId, s);
    } else if (s.targetType === "AD_GROUP") {
      resp = await applyAdGroup(profileId, s.accountId, s);
    } else if (s.targetType === "KEYWORD") {
      resp = await applyKeyword(profileId, s.accountId, s);
    } else if (s.targetType === "PRODUCT_TARGET") {
      resp = await applyProductTarget(profileId, s.accountId, s);
    } else {
      return { ok: false, message: `unsupported target type ${s.targetType}` };
    }

    return inspect207(resp);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Per-type dispatchers ────────────────────────────────────────────────────

async function applyCampaign(profileId: string, accountId: string, s: Suggestion) {
  const program = s.program;
  const state = stateFromAction(s);
  const budget = budgetFromAction(s);

  if (program === "SP") {
    return updateSPCampaigns(profileId, [{
      campaignId: s.targetId,
      ...(state && { state }),
      ...(budget != null && { budget: { budget, budgetType: "DAILY" } }),
    }], accountId);
  }
  if (program === "SB") {
    return updateSBCampaigns(profileId, [{
      campaignId: s.targetId,
      ...(state && { state }),
      ...(budget != null && { budget }),
    }], accountId);
  }
  if (program === "SD") {
    return updateSDCampaigns(profileId, [{
      campaignId: Number(s.targetId),
      ...(state && { state: state.toLowerCase() as "enabled" | "paused" }),
      ...(budget != null && { budget }),
    }], accountId);
  }
  throw new Error(`unknown program ${program}`);
}

async function applyAdGroup(profileId: string, accountId: string, s: Suggestion) {
  // Only SP ad-group updates wired — SB/SD ad-group state can be added later.
  if (s.program !== "SP") throw new Error(`ad-group apply not wired for ${s.program} yet`);
  const state = stateFromAction(s);
  const bid = bidFromAction(s);
  return updateSPAdGroups(profileId, [{
    adGroupId: s.targetId,
    ...(state && { state }),
    ...(bid != null && { defaultBid: bid }),
  }], accountId);
}

async function applyKeyword(profileId: string, accountId: string, s: Suggestion) {
  const state = stateFromAction(s);
  const bid = bidFromAction(s);
  return updateSPKeywords(profileId, [{
    keywordId: s.targetId,
    ...(state && { state }),
    ...(bid != null && { bid }),
  }], accountId);
}

async function applyProductTarget(profileId: string, accountId: string, s: Suggestion) {
  const state = stateFromAction(s);
  const bid = bidFromAction(s);
  return updateSPProductTargets(profileId, [{
    targetId: s.targetId,
    ...(state && { state }),
    ...(bid != null && { bid }),
  }], accountId);
}

// ─── action_type → field mapping ─────────────────────────────────────────────

function stateFromAction(s: Suggestion): "ENABLED" | "PAUSED" | undefined {
  if (s.actionType === "PAUSE")  return "PAUSED";
  if (s.actionType === "ENABLE") return "ENABLED";
  return undefined;
}

function bidFromAction(s: Suggestion): number | undefined {
  if (s.actionType === "SET_BID" || s.actionType === "BID_PCT") {
    return s.actionValue ?? undefined;
  }
  return undefined;
}

function budgetFromAction(s: Suggestion): number | undefined {
  if (s.actionType === "SET_BUDGET" || s.actionType === "BUDGET_PCT") {
    return s.actionValue ?? undefined;
  }
  return undefined;
}

// ─── HTTP 207 multi-status inspector ─────────────────────────────────────────

interface MultiStatusBody {
  campaigns?:        { success?: unknown[]; error?: { errors: { message: string; reason?: string }[] }[] };
  adGroups?:         { success?: unknown[]; error?: { errors: { message: string; reason?: string }[] }[] };
  keywords?:         { success?: unknown[]; error?: { errors: { message: string; reason?: string }[] }[] };
  targetingClauses?: { success?: unknown[]; error?: { errors: { message: string; reason?: string }[] }[] };
  // SD-style array body
  0?: { code?: string; description?: string };
}

function inspect207(resp: unknown): ApplyResult {
  if (resp == null) return { ok: true, message: "no body" };

  // Array form (SD's PUT /sd/campaigns returns [{code, description}])
  if (Array.isArray(resp)) {
    const failures = resp.filter((r) => (r as { code?: string }).code && (r as { code?: string }).code !== "200" && (r as { code?: string }).code !== "SUCCESS");
    if (failures.length === 0) return { ok: true, message: "applied" };
    return { ok: false, message: failures.map((f) => (f as { description?: string }).description ?? JSON.stringify(f)).join("; ") };
  }

  const body = resp as MultiStatusBody;
  for (const k of ["campaigns", "adGroups", "keywords", "targetingClauses"] as const) {
    const seg = body[k];
    if (!seg) continue;
    const errs = seg.error ?? [];
    if (errs.length === 0) return { ok: true, message: "applied" };
    return {
      ok: false,
      message: errs.map((e) => e.errors?.[0]?.message ?? e.errors?.[0]?.reason ?? "error").join("; ").slice(0, 300),
    };
  }
  return { ok: true, message: "applied (no error in response)" };
}
