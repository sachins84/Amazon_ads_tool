"use client";
import { useEffect, useState, useCallback, useMemo, use } from "react";
import Link from "next/link";
import TopNav from "@/components/shared/TopNav";
import DateRangePicker from "@/components/shared/DateRangePicker";
import { ChartSkeleton, KpiCardSkeleton } from "@/components/shared/Skeleton";
import { fmt } from "@/lib/utils";
import { useAccount } from "@/lib/account-context";

// Same shape as /api/campaigns/[id]/adgroups returns (see hierarchy-service.ts).
interface AdGroupRow {
  id: string; name: string; type: "SP" | "SB" | "SD";
  status: "ENABLED" | "PAUSED" | "ARCHIVED";
  defaultBid: number;
  spend: number; sales: number; orders: number;
  impressions: number; clicks: number;
  ctr: number; cpc: number; cvr: number; acos: number; roas: number;
}
interface AdGroupResponse {
  brandName: string | null;
  marketplace: string;
  currency: string;
  campaignId: string;
  dateRange: { startDate: string; endDate: string };
  adGroups: AdGroupRow[];
  dailySeries: { date: string; spend: number; sales: number }[];
  totals: { spend: number; sales: number; orders: number; clicks: number; impressions: number; acos: number; roas: number };
  errors: { adGroups: { program: string; error: string }[]; reports: { program: string; error: string }[] };
  freshness?: { lastRefreshAt: string | null; error: string | null; stale: boolean };
}

export default function CampaignDetailPage({ params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = use(params);
  const { activeAccount } = useAccount();
  const accountId = activeAccount?.id ?? "";

  const [dateRange, setDateRange] = useState("Last 7D");
  const [data, setData]           = useState<AdGroupResponse | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [warming, setWarming]     = useState(false);

  const load = useCallback(async () => {
    if (!accountId) { setLoading(false); return; }
    setLoading(true); setError(null);
    const t = setTimeout(() => setWarming(true), 4_000);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/adgroups?accountId=${accountId}&dateRange=${encodeURIComponent(dateRange)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as AdGroupResponse;
      setData(json);
    } catch (e) {
      setError(String(e));
    } finally {
      clearTimeout(t); setWarming(false); setLoading(false);
    }
  }, [accountId, campaignId, dateRange]);

  useEffect(() => { load(); }, [load]);

  const currency = data?.currency ?? (activeAccount?.adsMarketplace === "IN" ? "INR" : "USD");
  const sortedRows = useMemo(() => {
    if (!data?.adGroups) return [];
    return [...data.adGroups].sort((a, b) => b.spend - a.spend);
  }, [data]);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-base)" }}>
      <TopNav />
      <main style={{ padding: "24px 28px", maxWidth: 1600, margin: "0 auto" }}>
        {/* Header with breadcrumb */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4 }}>
              <Link href="/master-overview" style={{ color: "var(--text-secondary)", textDecoration: "none" }}>Master Overview</Link>
              <span style={{ margin: "0 6px" }}>›</span>
              <span style={{ color: "var(--text-primary)" }}>Campaign</span>
            </div>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.3px" }}>
              {data?.brandName ?? activeAccount?.name ?? "Campaign"} · Ad Groups
            </h1>
            <p style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>Campaign ID {campaignId} · {data?.adGroups.length ?? 0} ad groups · {dateRange}</p>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <DateRangePicker value={dateRange} onChange={setDateRange} compareValue="prev-period" onCompareChange={() => {}} showCompare={false} />
            <button onClick={load} disabled={loading} style={{
              padding: "6px 12px", borderRadius: 6, background: "var(--bg-input)",
              border: "1px solid var(--border)", color: loading ? "var(--text-muted)" : "var(--text-secondary)",
              cursor: loading ? "default" : "pointer", fontSize: 12,
            }}>
              {loading ? "Loading…" : "↻ Refresh"}
            </button>
          </div>
        </div>

        {!accountId && (
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", padding: 16, borderRadius: 8, fontSize: 13, color: "var(--text-secondary)" }}>
            Select a brand from the top-right dropdown.
          </div>
        )}

        {loading && warming && (
          <div style={{ background: "var(--c-info-banner-bg)", border: "1px solid var(--c-info-banner-bd)", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: "var(--c-indigo-text)" }}>
            ⏳ Fetching ad-group reports from Amazon. First load 30s–3 min cold; cached 1 hour after.
          </div>
        )}

        {error && (
          <div style={{ background: "var(--c-danger-banner-bg)", border: "1px solid var(--c-danger-banner-bd)", borderRadius: 8, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#ef4444" }}>
            ⚠ {error} <button onClick={load} style={{ marginLeft: 12, background: "transparent", border: "none", color: "#6366f1", cursor: "pointer" }}>Retry</button>
          </div>
        )}

        {/* Totals row */}
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

        {/* Daily chart */}
        {loading ? <ChartSkeleton /> : <DailyMini data={data?.dailySeries ?? []} currency={currency} />}

        {/* Ad groups table */}
        {!loading && (
          <div style={{ marginTop: 16, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: 20 }}>
            <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 12 }}>Ad Groups (sorted by spend)</h3>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                    <Th>Type</Th><Th>Status</Th><Th align="left">Ad Group</Th><Th align="right">Default Bid</Th>
                    <Th align="right">Spend</Th><Th align="right">Sales</Th><Th align="right">Orders</Th>
                    <Th align="right">ROAS</Th><Th align="right">ACOS</Th><Th align="right">CTR</Th><Th align="right">CPC</Th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((ag) => (
                    <tr key={ag.id} style={{ borderBottom: "1px solid var(--bg-input)" }}>
                      <Td><Pill text={ag.type} /></Td>
                      <Td><Pill text={ag.status} muted={ag.status !== "ENABLED"} /></Td>
                      <Td style={{ color: "var(--text-primary)", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <Link href={`/master-overview/adgroup/${ag.id}?campaignId=${campaignId}`} title={ag.name} style={{ color: "var(--c-indigo-text)", textDecoration: "none" }}>
                          {ag.name}
                        </Link>
                      </Td>
                      <Td align="right" style={{ color: "var(--text-secondary)" }}>{fmt(ag.defaultBid, "currency", currency)}</Td>
                      <Td align="right" style={{ color: "var(--text-primary)" }}>{fmt(ag.spend, "currency", currency)}</Td>
                      <Td align="right" style={{ color: "var(--text-primary)" }}>{fmt(ag.sales, "currency", currency)}</Td>
                      <Td align="right" style={{ color: "var(--text-secondary)" }}>{ag.orders}</Td>
                      <Td align="right" style={{ color: ag.roas >= 2 ? "#22c55e" : ag.roas >= 1 ? "#f59e0b" : "#ef4444" }}>{ag.roas.toFixed(2)}x</Td>
                      <Td align="right" style={{ color: ag.acos > 0 && ag.acos <= 25 ? "#22c55e" : ag.acos > 25 ? "#ef4444" : "var(--text-muted)" }}>{ag.acos.toFixed(1)}%</Td>
                      <Td align="right" style={{ color: "var(--text-secondary)" }}>{ag.ctr.toFixed(2)}%</Td>
                      <Td align="right" style={{ color: "var(--text-secondary)" }}>{fmt(ag.cpc, "currency", currency)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {sortedRows.length === 0 && <div style={{ padding: 16, color: "var(--text-muted)", fontSize: 12, textAlign: "center" }}>No ad groups in this campaign for this range.</div>}
            </div>
          </div>
        )}

        {/* Errors footer */}
        {data?.errors && (data.errors.adGroups.length + data.errors.reports.length) > 0 && (
          <div style={{ marginTop: 16, padding: 12, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11, color: "var(--text-secondary)" }}>
            <strong style={{ color: "#f59e0b" }}>Partial data:</strong>{" "}
            {data.errors.reports.map((e) => `${e.program} report failed`).join(", ")}
            {data.errors.adGroups.length > 0 && data.errors.reports.length > 0 ? "; " : ""}
            {data.errors.adGroups.map((e) => `${e.program} list failed`).join(", ")}
          </div>
        )}
      </main>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px" }}>
      <div style={{ fontSize: 10, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", marginTop: 4 }}>{value}</div>
    </div>
  );
}

function DailyMini({ data, currency }: { data: { date: string; spend: number; sales: number }[]; currency: string }) {
  if (!data.length) return <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: 20, height: 220, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 12 }}>No daily data</div>;
  const maxVal = Math.max(...data.flatMap((d) => [d.spend, d.sales])) || 1;
  const w = 100, h = 200, pad = 30;
  const pts = (key: "spend" | "sales") =>
    data.map((d, i) => `${pad + (i / (data.length - 1 || 1)) * (w - pad - 4)},${h - pad - (d[key] / maxVal) * (h - pad - 10)}`).join(" ");
  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>Daily Spend vs Sales</h3>
        <div style={{ display: "flex", gap: 16, fontSize: 11 }}>
          <span style={{ color: "#8b5cf6" }}>● Spend</span>
          <span style={{ color: "#22c55e" }}>● Sales</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height: h }}>
        <polyline points={pts("sales")} fill="none" stroke="#22c55e" strokeWidth="0.7" />
        <polyline points={pts("spend")} fill="none" stroke="#8b5cf6" strokeWidth="0.7" strokeDasharray="1 0.6" />
      </svg>
      <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 6, display: "flex", justifyContent: "space-between" }}>
        <span>{data[0]?.date}</span>
        <span>Max {fmt(maxVal, "compact", currency)}</span>
        <span>{data[data.length - 1]?.date}</span>
      </div>
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
    SP:       { bg: "var(--c-indigo-bg)", fg: "var(--c-indigo-text)" },
    SB:       { bg: "var(--c-violet-bg)", fg: "var(--c-violet-text)" },
    SD:       { bg: "var(--c-violet2-bg)", fg: "var(--c-violet2-text)" },
    ENABLED:  { bg: "var(--c-success-bg)",  fg: "var(--c-success-text)" },
    PAUSED:   { bg: "var(--c-warning-bg)", fg: "var(--c-warning-text)" },
    ARCHIVED: { bg: "var(--c-neutral-bg)",  fg: "var(--text-secondary)" },
  };
  const c = palette[text] ?? { bg: "var(--c-neutral-bg)", fg: "var(--text-secondary)" };
  return <span style={{ display: "inline-block", padding: "2px 6px", borderRadius: 4, background: c.bg, color: muted ? "var(--text-muted)" : c.fg, fontSize: 10, fontWeight: 600 }}>{text}</span>;
}
