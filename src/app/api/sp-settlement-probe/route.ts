import { spRequest } from "@/lib/sp-api/client";

export const dynamic = "force-dynamic";

/** GET /api/sp-settlement-probe — lists settlement reports (page 1 only). */
export async function GET() {
  const createdSince = new Date(); createdSince.setDate(createdSince.getDate() - 89);
  const createdUntil = new Date();
  const params = {
    reportTypes:  "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2",
    createdSince: `${createdSince.toISOString().split("T")[0]}T00:00:00Z`,
    createdUntil: `${createdUntil.toISOString().split("T")[0]}T23:59:59Z`,
    pageSize:     "100",
  };
  try {
    const res = await spRequest<{ reports: unknown[]; nextToken?: string }>(
      "/reports/2021-06-30/reports", { params }
    );
    return Response.json({
      ok: true,
      count: res.reports?.length ?? 0,
      hasNextToken: !!res.nextToken,
      reports: res.reports?.slice(0, 5),
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 200 });
  }
}
