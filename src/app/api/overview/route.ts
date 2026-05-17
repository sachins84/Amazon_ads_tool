import { type NextRequest } from "next/server";
import { getOverviewForAccount } from "@/lib/amazon-api/overview-service";
import { AmazonConfigError } from "@/lib/amazon-api/token";

// Force this route to be dynamic and never cached by Next.js, the runtime,
// or any upstream proxy/CDN. Without this, an old response body can stick
// around after a deploy and the UI keeps showing stale shape (e.g. missing
// the new `prev` field on KPIs).
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_CACHE = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  "Pragma":        "no-cache",
  "Expires":       "0",
};

/**
 * GET /api/overview?accountId=…&dateRange=…&campaignType=ALL|SP|SB|SD
 *
 * Single-account overview. Delegates to the shared service so /api/overview/all
 * can call the same builder in-process without an HTTP roundtrip.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const accountId    = searchParams.get("accountId") ?? "";
  const datePreset   = searchParams.get("dateRange") ?? "Last 30D";
  const campaignType = (searchParams.get("campaignType") ?? "ALL").toUpperCase();

  if (!accountId) {
    return Response.json(
      { error: "accountId is required", code: "CONFIG_MISSING" },
      { status: 200, headers: NO_CACHE },
    );
  }

  try {
    const data = await getOverviewForAccount(accountId, datePreset);

    if (campaignType !== "ALL") {
      const filtered = data.campaigns.filter((c) => c.type === campaignType);
      return Response.json({ ...data, campaigns: filtered }, { headers: NO_CACHE });
    }
    return Response.json(data, { headers: NO_CACHE });
  } catch (err) {
    if (err instanceof AmazonConfigError) {
      return Response.json({ error: err.message, code: "CONFIG_MISSING" }, { status: 500, headers: NO_CACHE });
    }
    if (err instanceof Error && err.message.includes("not found")) {
      return Response.json({ error: err.message }, { status: 404, headers: NO_CACHE });
    }
    console.error("[overview] Error:", err);
    return Response.json({ error: String(err) }, { status: 500, headers: NO_CACHE });
  }
}
