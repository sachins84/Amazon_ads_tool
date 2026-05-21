import { spRequest } from "@/lib/sp-api/client";

export const dynamic = "force-dynamic";

/** GET /api/sp-sellers-probe — returns raw /sellers/v1/marketplaceParticipations. */
export async function GET() {
  try {
    const data = await spRequest<unknown>("/sellers/v1/marketplaceParticipations");
    return Response.json({ raw: data });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 200 });
  }
}
