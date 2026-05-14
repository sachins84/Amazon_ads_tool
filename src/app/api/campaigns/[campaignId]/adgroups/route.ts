import { type NextRequest } from "next/server";
import { getAdGroupsForCampaign } from "@/lib/amazon-api/hierarchy-service";

interface Params { params: Promise<{ campaignId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { campaignId } = await params;
  const { searchParams } = req.nextUrl;
  const accountId  = searchParams.get("accountId") ?? "";
  const datePreset = searchParams.get("dateRange") ?? "Last 7D";

  if (!accountId) {
    return Response.json({ error: "accountId is required" }, { status: 400 });
  }

  try {
    const data = await getAdGroupsForCampaign(accountId, campaignId, datePreset);
    return Response.json(data);
  } catch (err) {
    if (err instanceof Error && err.message.includes("not found")) {
      return Response.json({ error: err.message }, { status: 404 });
    }
    console.error("[adgroups] Error:", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
