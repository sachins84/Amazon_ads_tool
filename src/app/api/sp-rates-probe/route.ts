import { fetchBrandFeeRates } from "@/lib/sp-api/brand-fees";
import { getSpMarketplaceId } from "@/lib/sp-api/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const mp = getSpMarketplaceId() ?? "";
  if (!mp) return Response.json({ error: "no marketplace" }, { status: 200 });
  try {
    const rates = await fetchBrandFeeRates(mp, 30);
    return Response.json({
      diagnostics: rates.diagnostics,
      byBrand: rates.byBrand,
    });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 200 });
  }
}
