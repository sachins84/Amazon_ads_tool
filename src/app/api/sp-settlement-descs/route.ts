import { type NextRequest } from "next/server";
import { spRequest } from "@/lib/sp-api/client";

export const dynamic = "force-dynamic";

/** Lists amount-description distribution in a settlement report. */
export async function GET(req: NextRequest) {
  const reportId = req.nextUrl.searchParams.get("reportId");
  if (!reportId) return Response.json({ error: "reportId required" }, { status: 400 });
  try {
    interface Status { reportDocumentId?: string }
    interface Doc { url: string; compressionAlgorithm?: string }
    const status = await spRequest<Status>(`/reports/2021-06-30/reports/${reportId}`);
    if (!status.reportDocumentId) return Response.json({ error: "no document" }, { status: 200 });
    const doc = await spRequest<Doc>(`/reports/2021-06-30/documents/${status.reportDocumentId}`);
    const res = await fetch(doc.url);
    let text: string;
    if (doc.compressionAlgorithm === "GZIP") {
      const { gunzipSync } = await import("zlib");
      text = gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf-8");
    } else {
      text = await res.text();
    }
    const lines = text.split(/\r?\n/).filter(Boolean);
    const headers = lines[0].split("\t");
    const iDesc = headers.indexOf("amount-description");
    const iType = headers.indexOf("amount-type");
    const iTxn  = headers.indexOf("transaction-type");
    const iAmt  = headers.indexOf("amount");
    const counts = new Map<string, { count: number; total: number; type: string; txn: string }>();
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split("\t");
      const desc = c[iDesc] ?? "";
      const type = c[iType] ?? "";
      const txn  = c[iTxn] ?? "";
      const amt  = Math.abs(parseFloat(c[iAmt] ?? "0") || 0);
      const k = `${txn}|${type}|${desc}`;
      const cur = counts.get(k) ?? { count: 0, total: 0, type, txn };
      cur.count++;
      cur.total += amt;
      counts.set(k, cur);
    }
    const breakdown = [...counts.entries()]
      .map(([k, v]) => ({ key: k, count: v.count, total: Math.round(v.total) }))
      .sort((a, b) => b.total - a.total);
    return Response.json({ reportId, totalLines: lines.length, breakdown });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 200 });
  }
}
