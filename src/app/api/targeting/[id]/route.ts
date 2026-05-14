import { type NextRequest } from "next/server";
import { updateSPKeywords, updateSPProductTargets } from "@/lib/amazon-api/targeting";
import { cacheDelete } from "@/lib/cache";
import { AmazonConfigError } from "@/lib/amazon-api/token";

interface Params { params: Promise<{ id: string }> }

/**
 * PATCH /api/targeting/:id
 * Body: { profileId|accountId, type: "KEYWORD"|"ASIN"|"CATEGORY"|"AUTO", bid?, status? }
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json() as {
    profileId?: string;
    accountId?: string;
    type: string;
    bid?: number;
    status?: "ENABLED" | "PAUSED" | "ARCHIVED";
  };

  const { profileId: bodyProfileId, accountId, type, bid, status } = body;
  if (!bodyProfileId && !accountId) {
    return Response.json({ error: "profileId or accountId is required" }, { status: 400 });
  }
  const profileId = bodyProfileId ?? "";

  try {
    const newState: "ENABLED" | "PAUSED" | undefined =
      status === "ENABLED" ? "ENABLED" :
      status === "PAUSED"  ? "PAUSED"  : undefined;

    if (type === "KEYWORD") {
      await updateSPKeywords(profileId, [{
        keywordId: id,
        ...(bid !== undefined && { bid }),
        ...(newState && { state: newState }),
      }], accountId);
    } else {
      await updateSPProductTargets(profileId, [{
        targetId: id,
        ...(bid !== undefined && { bid }),
        ...(newState && { state: newState }),
      }], accountId);
    }

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
