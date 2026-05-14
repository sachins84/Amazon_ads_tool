import { type NextRequest } from "next/server";
import { getTargetingForAdGroup } from "@/lib/amazon-api/hierarchy-service";

interface Params { params: Promise<{ adGroupId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { adGroupId } = await params;
  const { searchParams } = req.nextUrl;
  const accountId  = searchParams.get("accountId") ?? "";
  const datePreset = searchParams.get("dateRange") ?? "Last 7D";

  if (!accountId) {
    return Response.json({ error: "accountId is required" }, { status: 400 });
  }

  try {
    const data = await getTargetingForAdGroup(accountId, adGroupId, datePreset);
    return Response.json(data);
  } catch (err) {
    if (err instanceof Error && err.message.includes("not found")) {
      return Response.json({ error: err.message }, { status: 404 });
    }
    console.error("[targeting/adgroup] Error:", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
