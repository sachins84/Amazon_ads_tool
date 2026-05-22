import { type NextRequest } from "next/server";
import { spRequest } from "@/lib/sp-api/client";

export const dynamic = "force-dynamic";

/** GET /api/sp-settlement-raw?reportId=… — returns first 3 lines of raw TSV. */
export async function GET(req: NextRequest) {
  const reportId = req.nextUrl.searchParams.get("reportId");
  if (!reportId) return Response.json({ error: "reportId required" }, { status: 400 });
  try {
    interface Status { reportDocumentId?: string }
    interface Doc { url: string; compressionAlgorithm?: string }
    const status = await spRequest<Status>(`/reports/2021-06-30/reports/${reportId}`);
    if (!status.reportDocumentId) return Response.json({ error: "no document yet" }, { status: 200 });
    const doc = await spRequest<Doc>(`/reports/2021-06-30/documents/${status.reportDocumentId}`);
    const res = await fetch(doc.url);
    let text: string;
    if (doc.compressionAlgorithm === "GZIP") {
      const { gunzipSync } = await import("zlib");
      text = gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf-8");
    } else {
      text = await res.text();
    }
    const lines = text.split(/\r?\n/);
    return Response.json({
      reportId,
      totalLines: lines.length,
      header: lines[0],
      sampleRows: lines.slice(1, 5),
    });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 200 });
  }
}
