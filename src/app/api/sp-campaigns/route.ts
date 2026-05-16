import { type NextRequest } from "next/server";
import { getAccount } from "@/lib/db/accounts";
import { createSPCampaigns } from "@/lib/amazon-api/campaigns";
import { createSPAdGroups }  from "@/lib/amazon-api/adgroups";
import {
  createSPProductAds, createSPKeywords, createSPProductTargets, createSPAutoTargets,
} from "@/lib/amazon-api/targeting";

/**
 * POST /api/sp-campaigns
 *
 * Orchestrates the 4-step SP campaign create:
 *   1. Create campaign
 *   2. Create ad group
 *   3. Attach product ads (ASINs)
 *   4. Attach targeting (manual: keywords + product targets ; auto: 4 expression bids)
 *
 * Returns step-by-step results so the UI can show what landed.
 * Any step failing returns the partial state — Amazon doesn't have transactions
 * so the caller may need to clean up.
 *
 * Body shape: see CreateSpRequest below.
 */
export async function POST(req: NextRequest) {
  const body = await req.json() as CreateSpRequest;
  if (!body.accountId) return Response.json({ error: "accountId required" }, { status: 400 });

  const acct = getAccount(body.accountId);
  if (!acct) return Response.json({ error: "account not found" }, { status: 404 });
  const profileId = acct.adsProfileId;

  const out: CreateSpResponse = {
    steps: { campaign: null, adGroup: null, productAds: null, targeting: null },
    success: false,
  };

  // ── Step 1: campaign ────────────────────────────────────────────────────
  try {
    const r = await createSPCampaigns(profileId, [{
      name: body.campaign.name,
      budget: { budget: body.campaign.dailyBudget, budgetType: "DAILY" },
      startDate: body.campaign.startDate,
      endDate: body.campaign.endDate,
      state: body.campaign.state,
      targetingType: body.campaign.targetingType,
      portfolioId: body.campaign.portfolioId,
      dynamicBidding: body.campaign.dynamicBidding,
    }], body.accountId);
    const created = r.campaigns?.success?.[0];
    const failed  = r.campaigns?.error?.[0];
    if (!created) {
      out.steps.campaign = { ok: false, message: failed?.errors?.[0]?.message ?? "Campaign create failed" };
      return Response.json(out, { status: 207 });
    }
    out.steps.campaign = { ok: true, campaignId: created.campaignId };
  } catch (e) {
    out.steps.campaign = { ok: false, message: String(e) };
    return Response.json(out, { status: 500 });
  }

  const campaignId = out.steps.campaign.campaignId!;

  // ── Step 2: ad group ────────────────────────────────────────────────────
  try {
    const r = await createSPAdGroups(profileId, [{
      name: body.adGroup.name,
      campaignId,
      defaultBid: body.adGroup.defaultBid,
      state: body.adGroup.state,
    }], body.accountId);
    const created = r.adGroups?.success?.[0];
    const failed  = r.adGroups?.error?.[0];
    if (!created) {
      out.steps.adGroup = { ok: false, message: failed?.errors?.[0]?.message ?? "Ad-group create failed" };
      return Response.json(out, { status: 207 });
    }
    out.steps.adGroup = { ok: true, adGroupId: created.adGroupId };
  } catch (e) {
    out.steps.adGroup = { ok: false, message: String(e) };
    return Response.json(out, { status: 500 });
  }

  const adGroupId = out.steps.adGroup.adGroupId!;

  // ── Step 3: product ads (ASINs) ────────────────────────────────────────
  if (body.productAds && body.productAds.length > 0) {
    try {
      await createSPProductAds(profileId, body.productAds.map((p) => ({
        campaignId, adGroupId,
        asin: p.asin, sku: p.sku, state: "ENABLED",
      })), body.accountId);
      out.steps.productAds = { ok: true, count: body.productAds.length };
    } catch (e) {
      out.steps.productAds = { ok: false, message: String(e) };
      // continue — campaign + ad group exist already
    }
  }

  // ── Step 4: targeting ──────────────────────────────────────────────────
  try {
    if (body.campaign.targetingType === "AUTO" && body.auto) {
      await createSPAutoTargets(profileId, body.auto.map((a) => ({
        campaignId, adGroupId,
        type: a.type, bid: a.bid, state: "ENABLED",
      })), body.accountId);
      out.steps.targeting = { ok: true, kind: "AUTO", count: body.auto.length };
    } else if (body.campaign.targetingType === "MANUAL") {
      let count = 0;
      if (body.keywords && body.keywords.length > 0) {
        await createSPKeywords(profileId, body.keywords.map((k) => ({
          campaignId, adGroupId,
          keywordText: k.text, matchType: k.matchType, bid: k.bid, state: "ENABLED",
        })), body.accountId);
        count += body.keywords.length;
      }
      if (body.productTargets && body.productTargets.length > 0) {
        await createSPProductTargets(profileId, body.productTargets.map((t) => ({
          campaignId, adGroupId,
          expression: t.expression, bid: t.bid, state: "ENABLED",
        })), body.accountId);
        count += body.productTargets.length;
      }
      out.steps.targeting = { ok: true, kind: "MANUAL", count };
    }
  } catch (e) {
    out.steps.targeting = { ok: false, message: String(e) };
  }

  out.success = !!(out.steps.campaign?.ok && out.steps.adGroup?.ok);
  return Response.json(out, { status: out.success ? 201 : 207 });
}

// ─── Request / response types ───────────────────────────────────────────────

interface CreateSpRequest {
  accountId: string;
  campaign: {
    name: string;
    dailyBudget: number;
    startDate: string;            // YYYY-MM-DD
    endDate?: string;
    state: "ENABLED" | "PAUSED";
    targetingType: "MANUAL" | "AUTO";
    portfolioId?: string;
    dynamicBidding?: {
      strategy: "LEGACY_FOR_SALES" | "AUTO_FOR_SALES" | "MANUAL" | "RULE_BASED";
      placementBidding?: { placement: "PLACEMENT_TOP" | "PLACEMENT_PRODUCT_PAGE" | "PLACEMENT_REST_OF_SEARCH"; percentage: number }[];
    };
  };
  adGroup: {
    name: string;
    defaultBid: number;
    state: "ENABLED" | "PAUSED";
  };
  productAds?: { asin?: string; sku?: string }[];
  // MANUAL only:
  keywords?:       { text: string; matchType: "EXACT" | "PHRASE" | "BROAD"; bid?: number }[];
  productTargets?: { expression: { type: string; value?: string }[]; bid?: number }[];
  // AUTO only:
  auto?: { type: "queryHighRelMatches" | "queryBroadRelMatches" | "asinSubstituteRelated" | "asinAccessoryRelated"; bid?: number }[];
}

interface CreateSpResponse {
  success: boolean;
  steps: {
    campaign:   { ok: boolean; campaignId?: string; message?: string } | null;
    adGroup:    { ok: boolean; adGroupId?:  string; message?: string } | null;
    productAds: { ok: boolean; count?:      number; message?: string } | null;
    targeting:  { ok: boolean; kind?: "MANUAL" | "AUTO"; count?: number; message?: string } | null;
  };
}
