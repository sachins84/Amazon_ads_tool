import { type NextRequest } from "next/server";
import { updateSPKeywords, updateSPProductTargets } from "@/lib/amazon-api/targeting";
import { cacheDelete } from "@/lib/cache";
import { AmazonConfigError } from "@/lib/amazon-api/token";

interface BulkTarget {
  id: string;
  type: "KEYWORD" | "ASIN" | "CATEGORY" | "AUTO";
}

type BulkAction =
  | "enable" | "pause" | "archive"
  | "bid_exact" | "bid_increase_pct" | "bid_decrease_pct" | "bid_suggested";

/**
 * POST /api/targeting/bulk
 * Body: { profileId|accountId, targets: [{id, type}], action, bidValue? }
 */
export async function POST(req: NextRequest) {
  const body = await req.json() as {
    profileId?: string;
    accountId?: string;
    targets: BulkTarget[];
    action: BulkAction;
    bidValue?: number;
    currentBids?: Record<string, number>;
    suggestedBids?: Record<string, number>;
  };

  const { profileId = "", accountId, targets, action, bidValue, currentBids = {}, suggestedBids = {} } = body;
  if (!profileId && !accountId) return Response.json({ error: "profileId or accountId required" }, { status: 400 });
  if (!targets?.length)         return Response.json({ error: "targets required" }, { status: 400 });

  try {
    const keywords = targets.filter((t) => t.type === "KEYWORD");
    const products = targets.filter((t) => t.type !== "KEYWORD");

    const toState = (a: BulkAction): "ENABLED" | "PAUSED" | undefined =>
      a === "enable" ? "ENABLED" : a === "pause" ? "PAUSED" : undefined;

    const calcBid = (id: string): number | undefined => {
      if (action === "bid_exact")        return bidValue;
      if (action === "bid_increase_pct") return Math.round((currentBids[id] ?? 0) * (1 + (bidValue ?? 0) / 100) * 100) / 100;
      if (action === "bid_decrease_pct") return Math.max(0.02, Math.round((currentBids[id] ?? 0) * (1 - (bidValue ?? 0) / 100) * 100) / 100);
      if (action === "bid_suggested")    return suggestedBids[id];
      return undefined;
    };

    const state = toState(action);
    // Note: archive isn't supported on the v3 update endpoints used here.

    if (keywords.length) {
      await updateSPKeywords(
        profileId,
        keywords.map((t) => ({
          keywordId: t.id,
          ...(state && { state }),
          ...(calcBid(t.id) !== undefined && { bid: calcBid(t.id) }),
        })),
        accountId,
      );
    }

    if (products.length) {
      await updateSPProductTargets(
        profileId,
        products.map((t) => ({
          targetId: t.id,
          ...(state && { state }),
          ...(calcBid(t.id) !== undefined && { bid: calcBid(t.id) }),
        })),
        accountId,
      );
    }

    cacheDelete(`targeting:${accountId || profileId}`);
    return Response.json({ success: true, updated: targets.length });
  } catch (err) {
    if (err instanceof AmazonConfigError) {
      return Response.json({ error: err.message, code: "CONFIG_MISSING" }, { status: 500 });
    }
    console.error("[targeting/bulk] Error:", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
