import { type NextRequest } from "next/server";
import { spRequest, getSpMarketplaceId } from "@/lib/sp-api/client";

export const dynamic = "force-dynamic";

/**
 * GET /api/sp-catalog-probe?asin=B092ZXX7XP[&marketplaceId=…&includedData=…]
 *
 * Pass-through diagnostic — returns Amazon's raw catalog response so we
 * can see what fields actually come back for an ASIN that our brand-split
 * sees as "empty title". Defaults includedData to summaries,attributes so
 * we get both itemName/brandName from summaries AND raw attributes if
 * summaries is sparse.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const asin = sp.get("asin");
  const marketplaceId = sp.get("marketplaceId") ?? getSpMarketplaceId() ?? "";
  const includedData = sp.get("includedData") ?? "summaries,attributes";
  if (!asin)         return Response.json({ error: "asin required" }, { status: 400 });
  if (!marketplaceId) return Response.json({ error: "marketplaceId required" }, { status: 400 });

  try {
    const path = `/catalog/2022-04-01/items?identifiers=${encodeURIComponent(asin)}&identifiersType=ASIN&marketplaceIds=${marketplaceId}&includedData=${encodeURIComponent(includedData)}`;
    const data = await spRequest<unknown>(path);
    return Response.json({ asin, marketplaceId, raw: data });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 200 });
  }
}
