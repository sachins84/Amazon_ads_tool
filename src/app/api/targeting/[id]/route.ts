import { type NextRequest } from "next/server";
import { updateSPKeywords, updateSPProductTargets } from "@/lib/amazon-api/targeting";
import { cacheDelete } from "@/lib/cache";
import { AmazonConfigError } from "@/lib/amazon-api/token";

interface Params { params: Promise<{ id: string }> }

/**
 * PATCH /api/targeting/:id
 * Body: { profileId, type: "KEYWORD"|"ASIN"|"CATEGORY"|"AUTO", bid?, status? }
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json() as {
    profileId: string;
    accountId?: string;
    type: string;
    bid?: number;
    status?: string;
  };

  const { profileId: bodyProfileId, type, bid, status } = body;
  const accountId = (body as { accountId?: string }).accountId;

  // Require either accountId or profileId
  if (!bodyProfileId && !accountId) {
    return Response.json({ error: "profileId or accountId is required" }, { status: 400 });
  }

  const profileId = bodyProfileId ?? "";

  const numericId = parseInt(id, 10);
  if (isNaN(numericId)) {
    return Response.json({ error: "Invalid target id" }, { status: 400 });
  }

  try {
    const amazonState = status === "ENABLED" ? "enabled"
      : status === "PAUSED" ? "paused"
      : status === "ARCHIVED" ? "archived"
      : undefined;

    if (type === "KEYWORD") {
      await updateSPKeywords(profileId, [{
        keywordId: numericId,
        ...(bid !== undefined && { bid }),
        ...(amazonState && { state: amazonState }),
      }], accountId);
    } else {
      await updateSPProductTargets(profileId, [{
        targetId: numericId,
        ...(bid !== undefined && { bid }),
        ...(amazonState && { state: amazonState }),
      }], accountId);
    }

    // Invalidate targeting cache for this account/profile
    cacheDelete(`targeting:${accountId || profileId}`);

    return Response.json({ success: true, id, bid, status });
  } catch (err) {
    if (err instanceof AmazonConfigError) {
      return Response.json({ error: err.message, code: "CONFIG_MISSING" }, { status: 500 });
    }
    console.error("[targeting/[id]] Error:", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
