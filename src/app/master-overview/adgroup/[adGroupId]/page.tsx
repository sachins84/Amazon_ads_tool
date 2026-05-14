"use client";
import { useEffect, useState, useCallback, useMemo, use } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import TopNav from "@/components/shared/TopNav";
import DateRangePicker from "@/components/shared/DateRangePicker";
import { ChartSkeleton, KpiCardSkeleton } from "@/components/shared/Skeleton";
import { fmt } from "@/lib/utils";
import { useAccount } from "@/lib/account-context";

interface TargetingRow {
  id: string;
  kind: "KEYWORD" | "PRODUCT_TARGET";
  display: string;
  matchType?: "EXACT" | "PHRASE" | "BROAD";
  state: "ENABLED" | "PAUSED" | "ARCHIVED";
  bid: number;
  campaignId: string;
  adGroupId: string;
  spend: number; sales: number; orders: number;
  impressions: number; clicks: number;
  ctr: number; cpc: number; cvr: number; acos: number; roas: number;
}
interface TargetingResponse {
  brandName: string | null;
  marketplace: string;
  currency: string;
  campaignId: string;
  adGroupId: string;
  dateRange: { startDate: string; endDate: string };
  keywords: TargetingRow[];
  productTargets: TargetingRow[];
  totals: { spend: number; sales: number; orders: number; clicks: number; impressions: number; acos: number; roas: number };
  errors: { keywords?: string; productTargets?: string; report?: string };
}

type Tab = "KEYWORDS" | "PRODUCT_TARGETS";

export default function AdGroupDetailPage({ params }: { params: Promise<{ adGroupId: string }> }) {
  const { adGroupId } = use(params);
  const searchParams = useSearchParams();
  const campaignIdHint = searchParams.get("campaignId") ?? "";

  const { activeAccount } = useAccount();
  const accountId = activeAccount?.id ?? "";

  const [dateRange, setDateRange] = useState("Last 7D");
  const [data, setData] = useState<TargetingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("KEYWORDS");
  const [warming, setWarming] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) { setLoading(false); return; }
    setLoading(true); setError(null);
    const t = setTimeout(() => setWarming(true), 4_000);
    try {
      const res = await fetch(`/api/adgroups/${adGroupId}/targeting?accountId=${accountId}&dateRange=${encodeURIComponent(dateRange)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as TargetingResponse;
      setData(json);
    } catch (e) {
      setError(String(e));
    } finally {
      clearTimeout(t); setWarming(false); setLoading(false);
    }
  }, [accountId, adGroupId, dateRange]);

  useEffect(() => { load(); }, [load]);

  const currency = data?.currency ?? (activeAccount?.adsMarketplace === "IN" ? "INR" : "USD");
  const rows = useMemo(() => {
    if (!data) return [];
    const arr = tab === "KEYWORDS" ? data.keywords : data.productTargets;
    return [...arr].sort((a, b) => b.spend - a.spend);
  }, [data, tab]);

  const linkBackToCampaign = data?.campaignId || campaignIdHint;

  return (
    <div style={{ minHeight: "100vh", background: "#0d1117" }}>
      <TopNav />
      <main style={{ padding: "24px 28px", maxWidth: 1600, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: "#8892a4", marginBottom: 4 }}>
              <Link href="/master-overview" style={{ color: "#8892a4", textDecoration: "none" }}>Master Overview</Link>
              <span style={{ margin: "0 6px" }}>›</span>
              {linkBackToCampaign ? (
                <>
                  <Link href={`/master-overview/campaign/${linkBackToCampaign}`} style={{ color: "#8892a4", textDecoration: "none" }}>Campaign</Link>
                  <span style={{ margin: "0 6px" }}>›</span>
                </>
              ) : null}
              <span style={{ color: "#e2e8f0" }}>Ad Group</span>
            </div>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: "#e2e8f0", letterSpacing: "-0.3px" }}>
              {data?.brandName ?? activeAccount?.name ?? "Ad Group"} · Targeting
            </h1>
            <p style={{ fontSize: 12, color: "#8892a4", marginTop: 2 }}>
              Ad Group {adGroupId} · {data?.keywords.length ?? 0} keywords · {data?.productTargets.length ?? 0} product targets · {dateRange}
            </p>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <DateRangePicker value={dateRange} onChange={setDateRange} compareValue="prev-period" onCompareChange={() => {}} showCompare={false} />
            <button onClick={load} disabled={loading} style={{
              padding: "6px 12px", borderRadius: 6, background: "#1c2333",
              border: "1px solid #2a3245", color: loading ? "#555f6e" : "#8892a4",
              cursor: loading ? "default" : "pointer", fontSize: 12,
            }}>
              {loading ? "Loading…" : "↻ Refresh"}
            </button>
          </div>
        </div>

        {!accountId && (
          <div style={{ background: "#161b27", border: "1px solid #2a3245", padding: 16, borderRadius: 8, fontSize: 13, color: "#8892a4" }}>
            Select a brand from the top-right dropdown.
          </div>
        )}

        {loading && warming && (
          <div style={{ background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: "#a5b4fc" }}>
            ⏳ Fetching targeting report from Amazon. First load 30s–3 min; cached 1 hour after.
          </div>
        )}

        {error && (
          <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#ef4444" }}>
            ⚠ {error} <button onClick={load} style={{ marginLeft: 12, background: "transparent", border: "none", color: "#6366f1", cursor: "pointer" }}>Retry</button>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12, marginBottom: 16 }}>
          {loading ? Array.from({ length: 5 }).map((_, i) => <KpiCardSkeleton key={i} small />) : data?.totals ? (
            <>
              <Tile label="Spend"  value={fmt(data.totals.spend, "currency", currency)} />
              <Tile label="Sales"  value={fmt(data.totals.sales, "currency", currency)} />
              <Tile label="Orders" value={fmt(data.totals.orders, "number", currency)} />
              <Tile label="ROAS"   value={`${data.totals.roas.toFixed(2)}x`} />
              <Tile label="ACOS"   value={`${data.totals.acos.toFixed(1)}%`} />
            </>
          ) : null}
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
          {(["KEYWORDS","PRODUCT_TARGETS"] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: "6px 14px", borderRadius: 6, fontSize: 12,
              background: tab === t ? "#1c2333" : "transparent",
              color: tab === t ? "#e2e8f0" : "#8892a4",
              border: tab === t ? "1px solid #2a3245" : "1px solid transparent",
              fontWeight: tab === t ? 600 : 400,
              cursor: "pointer",
            }}>
              {t === "KEYWORDS" ? `Keywords (${data?.keywords.length ?? 0})` : `Product Targets (${data?.productTargets.length ?? 0})`}
            </button>
          ))}
        </div>

        {!loading && (
          <div style={{ background: "#161b27", border: "1px solid #2a3245", borderRadius: 10, padding: 20 }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #2a3245", color: "#8892a4" }}>
                    {tab === "KEYWORDS" && <Th>Match</Th>}
                    <Th>Status</Th>
                    <Th align="left">{tab === "KEYWORDS" ? "Keyword" : "Target"}</Th>
                    <Th align="right">Bid</Th>
                    <Th align="right">Spend</Th><Th align="right">Sales</Th><Th align="right">Orders</Th>
                    <Th align="right">ROAS</Th><Th align="right">ACOS</Th><Th align="right">CTR</Th><Th align="right">CPC</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} style={{ borderBottom: "1px solid #1c2333" }}>
                      {tab === "KEYWORDS" && <Td><Pill text={r.matchType ?? ""} /></Td>}
                      <Td><Pill text={r.state} muted={r.state !== "ENABLED"} /></Td>
                      <Td style={{ color: "#e2e8f0", maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.display}>{r.display}</Td>
                      <Td align="right" style={{ color: "#8892a4" }}>{fmt(r.bid, "currency", currency)}</Td>
                      <Td align="right" style={{ color: "#e2e8f0" }}>{fmt(r.spend, "currency", currency)}</Td>
                      <Td align="right" style={{ color: "#e2e8f0" }}>{fmt(r.sales, "currency", currency)}</Td>
                      <Td align="right" style={{ color: "#8892a4" }}>{r.orders}</Td>
                      <Td align="right" style={{ color: r.roas >= 2 ? "#22c55e" : r.roas >= 1 ? "#f59e0b" : "#ef4444" }}>{r.roas.toFixed(2)}x</Td>
                      <Td align="right" style={{ color: r.acos > 0 && r.acos <= 25 ? "#22c55e" : r.acos > 25 ? "#ef4444" : "#555f6e" }}>{r.acos.toFixed(1)}%</Td>
                      <Td align="right" style={{ color: "#8892a4" }}>{r.ctr.toFixed(2)}%</Td>
                      <Td align="right" style={{ color: "#8892a4" }}>{fmt(r.cpc, "currency", currency)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length === 0 && (
                <div style={{ padding: 16, color: "#555f6e", fontSize: 12, textAlign: "center" }}>
                  No {tab === "KEYWORDS" ? "keywords" : "product targets"} in this ad group for this range.
                </div>
              )}
            </div>
          </div>
        )}

        {data?.errors && (data.errors.keywords || data.errors.productTargets || data.errors.report) && (
          <div style={{ marginTop: 16, padding: 12, background: "#161b27", border: "1px solid #2a3245", borderRadius: 8, fontSize: 11, color: "#8892a4" }}>
            <strong style={{ color: "#f59e0b" }}>Partial data:</strong>{" "}
            {data.errors.keywords ? "keywords list failed; " : ""}
            {data.errors.productTargets ? "product-targets list failed; " : ""}
            {data.errors.report ? "report failed (metrics may be empty)" : ""}
          </div>
        )}
      </main>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "#161b27", border: "1px solid #2a3245", borderRadius: 10, padding: "14px 16px" }}>
      <div style={{ fontSize: 10, color: "#8892a4", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: "#e2e8f0", marginTop: 4 }}>{value}</div>
    </div>
  );
}
function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <th style={{ textAlign: align, padding: "8px 6px", fontWeight: 500, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>{children}</th>;
}
function Td({ children, align = "left", style, title }: { children: React.ReactNode; align?: "left" | "right"; style?: React.CSSProperties; title?: string }) {
  return <td style={{ textAlign: align, padding: "10px 6px", ...style }} title={title}>{children}</td>;
}
function Pill({ text, muted }: { text: string; muted?: boolean }) {
  const palette: Record<string, { bg: string; fg: string }> = {
    EXACT:    { bg: "rgba(99,102,241,0.15)", fg: "#a5b4fc" },
    PHRASE:   { bg: "rgba(139,92,246,0.15)", fg: "#c4b5fd" },
    BROAD:    { bg: "rgba(167,139,250,0.15)", fg: "#ddd6fe" },
    ENABLED:  { bg: "rgba(34,197,94,0.15)",  fg: "#86efac" },
    PAUSED:   { bg: "rgba(245,158,11,0.15)", fg: "#fde68a" },
    ARCHIVED: { bg: "rgba(85,95,110,0.20)",  fg: "#8892a4" },
  };
  const c = palette[text] ?? { bg: "rgba(85,95,110,0.20)", fg: "#8892a4" };
  return <span style={{ display: "inline-block", padding: "2px 6px", borderRadius: 4, background: c.bg, color: muted ? "#555f6e" : c.fg, fontSize: 10, fontWeight: 600 }}>{text}</span>;
}
