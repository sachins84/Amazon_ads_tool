"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import TopNav from "@/components/shared/TopNav";
import DateRangePicker from "@/components/shared/DateRangePicker";
import KpiCard from "@/components/shared/KpiCard";
import { KpiCardSkeleton, ChartSkeleton } from "@/components/shared/Skeleton";
import { fetchOverview, fetchAllBrands, refreshAccountMetrics, type OverviewData, type AllBrandsResponse, type OverviewCampaignRow } from "@/lib/api-client";
import { fmt, currencySymbol } from "@/lib/utils";
import { useAccount } from "@/lib/account-context";

export default function MasterOverviewPage() {
  const [dateRange, setDateRange] = useState("Last 7D");
  const [overview, setOverview]   = useState<OverviewData | null>(null);
  const [allBrands, setAllBrands] = useState<AllBrandsResponse | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);

  const { activeAccount, accounts } = useAccount();
  const accountId = activeAccount?.id ?? "";
  const isAllBrands = !accountId;

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      if (isAllBrands) {
        const data = await fetchAllBrands({ dateRange });
        setAllBrands(data); setOverview(null);
      } else {
        const data = await fetchOverview({ accountId, dateRange });
        setOverview(data); setAllBrands(null);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [accountId, dateRange, isAllBrands]);

  const refresh = useCallback(async (days = 21) => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshNote(`Pulling last ${days} days from Amazon… runs in the background, expect 5–15 min for India accounts. The page will pick up data as it lands.`);
    try {
      if (isAllBrands) {
        await refreshAccountMetrics({ all: true, days });
      } else {
        await refreshAccountMetrics({ accountId, days });
      }
      // Endpoint returns 202 immediately — refresh continues server-side.
      // Reload the current view; data will start showing as each pull completes.
      // Schedule a few re-loads at 60s / 5m / 12m to catch the data without
      // making the user click again.
      for (const delaySec of [60, 300, 720]) {
        setTimeout(() => { void load(); }, delaySec * 1000);
      }
      setRefreshNote(`✓ Refresh started in the background. Reload (or wait — the page auto-checks at 1, 5, and 12 min).`);
    } catch (e) {
      setRefreshNote(`Refresh failed to start: ${String(e)}`);
    } finally {
      setRefreshing(false);
      setTimeout(() => setRefreshNote(null), 12000);
    }
  }, [accountId, isAllBrands, load, refreshing]);

  useEffect(() => { load(); }, [load]);

  const currency = overview?.currency ?? (activeAccount?.adsMarketplace === "IN" ? "INR" : "USD");
  const headline = isAllBrands
    ? "All Brands"
    : (overview?.brandName ?? activeAccount?.name ?? "Master Overview");
  const subtitle = isAllBrands
    ? `${accounts.length} connected accounts · ${dateRange}`
    : `${overview?.marketplace ?? activeAccount?.adsMarketplace ?? ""} · ${currency} · ${dateRange}`;

  const chartData = useMemo(() => {
    if (!overview?.dailySeries?.length) return [];
    return overview.dailySeries.map((d) => ({
      date: d.date.slice(5),
      spend: d.spend,
      sales: d.sales,
    }));
  }, [overview]);

  const topCampaigns: OverviewCampaignRow[] = useMemo(() => {
    if (!overview?.campaigns) return [];
    return [...(overview.campaigns as OverviewCampaignRow[])]
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 10);
  }, [overview]);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-base)" }}>
      <TopNav />
      <main style={{ padding: "24px 28px", maxWidth: 1600, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.4px" }}>{headline}</h1>
            <p style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>{subtitle}</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <DateRangePicker value={dateRange} onChange={setDateRange} compareValue="prev-period" onCompareChange={() => {}} showCompare={false} />
            <button onClick={load} disabled={loading} style={btnGhost(loading)}>
              <span style={{ animation: loading ? "spin 1s linear infinite" : "none", display: "inline-block" }}>↻</span> {loading ? "Loading…" : "Reload"}
            </button>
            <button onClick={() => refresh(14)} disabled={refreshing} style={btnPrimary(refreshing)} title="Pull last 14 days from Amazon (re-captures attribution backfill)">
              {refreshing ? "Refreshing…" : "↻ Refresh from Amazon"}
            </button>
          </div>
        </div>

        {refreshNote && (
          <div style={{
            background: "var(--c-info-banner-bg)", border: "1px solid var(--c-info-banner-bd)",
            borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: "var(--c-indigo-text)",
          }}>
            {refreshing ? "⏳ " : "✓ "}{refreshNote}
          </div>
        )}

        {!isAllBrands && !loading && overview?.freshness?.stale && !refreshing && (
          <div style={{
            background: "var(--c-warning-banner-bg)", border: "1px solid var(--c-warning-banner-bd)",
            borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: "var(--c-warning-text)",
            display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
          }}>
            <span>⚠ No data stored for this range. Click <strong>↻ Refresh from Amazon</strong> to backfill, or <button onClick={() => refresh(60)} style={{ ...btnGhost(false), color: "var(--c-warning-text)", padding: "2px 8px" }}>pull 60 days (first-time)</button>.</span>
          </div>
        )}

        {!isAllBrands && !loading && overview?.freshness?.lastRefreshAt && !overview.freshness.stale && (
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 12 }}>
            Last refreshed {humanTime(overview.freshness.lastRefreshAt)} · window {overview.freshness.windowStart} → {overview.freshness.windowEnd} · {overview.freshness.rowCount.toLocaleString()} rows stored
            {overview.freshness.error ? <span style={{ color: "#f59e0b" }}> · last refresh had errors</span> : null}
          </div>
        )}

        {error && (
          <div style={{
            background: "var(--c-danger-banner-bg)", border: "1px solid var(--c-danger-banner-bd)",
            borderRadius: 8, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#ef4444",
          }}>
            ⚠ {error}
            <button onClick={load} style={{ marginLeft: 12, color: "#6366f1", background: "transparent", border: "none", cursor: "pointer", fontSize: 12 }}>Retry</button>
          </div>
        )}

        {isAllBrands ? (
          <AllBrandsView data={allBrands} loading={loading} />
        ) : (
          <SingleBrandView data={overview} loading={loading} currency={currency} chartData={chartData} topCampaigns={topCampaigns} />
        )}
      </main>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } } @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .5; } }`}</style>
    </div>
  );
}

// ─── Single-brand view ───────────────────────────────────────────────────────

function SingleBrandView({
  data, loading, currency, chartData, topCampaigns,
}: {
  data: OverviewData | null;
  loading: boolean;
  currency: string;
  chartData: { date: string; spend: number; sales: number }[];
  topCampaigns: OverviewCampaignRow[];
}) {
  // Pass the metric straight through so KpiCard sees value + prev + delta.
  // Fallback object (used while loading or for missing KPIs) has delta:0 and
  // no prev — KpiCard renders the loading state for those.
  const k = data?.kpis;
  type M = { value: number; prev?: number; delta: number; positive: boolean };
  const fallback = (positive: boolean): M => ({ value: 0, delta: 0, positive });
  const spend  = (k?.spend  as M) ?? fallback(false);
  const sales  = (k?.sales  as M) ?? fallback(true);
  const orders = (k?.orders as M) ?? fallback(true);
  const roas   = (k?.roas   as M) ?? fallback(true);
  const acos   = (k?.acos   as M) ?? fallback(false);
  const ctr    = (k?.ctr    as M) ?? fallback(true);
  const cpc    = (k?.cpc    as M) ?? fallback(false);
  const cvr    = (k?.cvr    as M) ?? fallback(true);
  const impr   = (k?.impressions as M) ?? fallback(true);
  const clicks = (k?.clicks as M) ?? fallback(true);

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 12 }}>
        {loading ? Array.from({ length: 4 }).map((_, i) => <KpiCardSkeleton key={i} />) : (
          <>
            <KpiCard label="Spend"  metric={spend}  format="currency"   currency={currency} />
            <KpiCard label="Sales"  metric={sales}  format="currency"   currency={currency} />
            <KpiCard label="Orders" metric={orders} format="number"     currency={currency} />
            <KpiCard label="ROAS"   metric={roas}   format="multiplier" currency={currency} />
          </>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12, marginBottom: 16 }}>
        {loading ? Array.from({ length: 6 }).map((_, i) => <KpiCardSkeleton key={i} small />) : (
          <>
            <KpiCard label="ACOS"        metric={acos}   format="percent"  currency={currency} small />
            <KpiCard label="CTR"         metric={ctr}    format="percent"  currency={currency} small />
            <KpiCard label="CPC"         metric={cpc}    format="currency" currency={currency} small />
            <KpiCard label="CVR"         metric={cvr}    format="percent"  currency={currency} small />
            <KpiCard label="Impressions" metric={impr}   format="compact"  currency={currency} small />
            <KpiCard label="Clicks"      metric={clicks} format="compact"  currency={currency} small />
          </>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginBottom: 16 }}>
        {loading ? <ChartSkeleton /> : <DailyChart data={chartData} currency={currency} />}
        {loading ? <ChartSkeleton /> : <SpendByProgram items={data?.spendByType ?? []} currency={currency} />}
      </div>

      {!loading && topCampaigns.length > 0 && (
        <CampaignTable rows={topCampaigns} currency={currency} />
      )}

      {data?.errors && (data.errors.campaigns.length + data.errors.reports.length) > 0 && (
        <div style={{ marginTop: 16, padding: 12, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11, color: "var(--text-secondary)" }}>
          <strong style={{ color: "#f59e0b" }}>Partial data:</strong>{" "}
          {data.errors.reports.map((e) => `${e.program} report failed`).join(", ")}
          {data.errors.campaigns.length > 0 && data.errors.reports.length > 0 ? "; " : ""}
          {data.errors.campaigns.map((e) => `${e.program} list failed`).join(", ")}
          . Numbers shown are from programs that succeeded.
        </div>
      )}
    </>
  );
}

// ─── All-brands view ─────────────────────────────────────────────────────────

function AllBrandsView({ data, loading }: { data: AllBrandsResponse | null; loading: boolean }) {
  if (loading) {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
        {Array.from({ length: 4 }).map((_, i) => <KpiCardSkeleton key={i} />)}
      </div>
    );
  }
  if (!data) return null;

  return (
    <>
      {Object.values(data.byCurrency).length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${Object.keys(data.byCurrency).length}, 1fr)`, gap: 12, marginBottom: 16 }}>
          {Object.values(data.byCurrency).map((g) => (
            <div key={g.currency} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: "16px 20px" }}>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {g.currency} total · {g.accounts} account{g.accounts === 1 ? "" : "s"}
              </div>
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                <Metric label="Spend"  value={fmt(g.spend, "currency", g.currency)} />
                <Metric label="Sales"  value={fmt(g.sales, "currency", g.currency)} />
                <Metric label="Orders" value={fmt(g.orders, "number", g.currency)} />
                <Metric label="ROAS"   value={`${g.roas.toFixed(2)}x`} />
                <Metric label="ACOS"   value={`${g.acos.toFixed(1)}%`} />
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Brands</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
        {data.accounts.map((a) => <BrandCard key={a.accountId} a={a} />)}
      </div>
    </>
  );
}

function BrandCard({ a }: { a: AllBrandsResponse["accounts"][number] }) {
  // currencySymbol kept around for future inline tooltips; not used directly here.
  void currencySymbol;
  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: a.color || "#6366f1" }} />
        <div style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 600 }}>{a.name}</div>
      </div>
      <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{a.marketplace} · {a.currency} · profile {a.profileId}</div>
      {a.error ? (
        <div style={{ fontSize: 11, color: "#ef4444", padding: "8px 0" }}>⚠ {a.error.slice(0, 90)}…</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12 }}>
            <Mini label="Spend"  value={fmt(a.spend, "currency", a.currency)} />
            <Mini label="Sales"  value={fmt(a.sales, "currency", a.currency)} />
            <Mini label="ROAS"   value={`${a.roas.toFixed(2)}x`} />
            <Mini label="Orders" value={fmt(a.orders, "number", a.currency)} />
          </div>
          <div style={{ fontSize: 11, color: "var(--text-secondary)", display: "flex", justifyContent: "space-between" }}>
            <span>{a.activeCampaigns} active campaigns</span>
            <span>ACOS {a.acos.toFixed(1)}%</span>
          </div>
        </>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: 18, color: "var(--text-primary)", fontWeight: 700 }}>{value}</div>
    </div>
  );
}
function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--text-secondary)" }}>{label}</div>
      <div style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 600 }}>{value}</div>
    </div>
  );
}

// ─── Daily chart (inline SVG so we avoid recharts type churn) ────────────────

function DailyChart({ data, currency }: { data: { date: string; spend: number; sales: number }[]; currency: string }) {
  if (!data.length) {
    return (
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: 20, height: 280, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 12 }}>
        No daily data in this range
      </div>
    );
  }
  const maxVal = Math.max(...data.flatMap((d) => [d.spend, d.sales])) || 1;
  const w = 100, h = 220, pad = 30;
  const pts = (key: "spend" | "sales") =>
    data.map((d, i) =>
      `${pad + (i / (data.length - 1 || 1)) * (w - pad - 4)},${h - pad - (d[key] / maxVal) * (h - pad - 10)}`
    ).join(" ");

  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: 20 }}>
      <div style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div>
          <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>Daily Spend vs Sales</h3>
          <p style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>{data.length} days</p>
        </div>
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

// ─── Spend by program ────────────────────────────────────────────────────────

function SpendByProgram({ items, currency }: { items: { name: string; code?: string; value: number; color: string }[]; currency: string }) {
  const total = items.reduce((s, i) => s + i.value, 0);
  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: 20 }}>
      <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 12 }}>Spend by Program</h3>
      <div style={{ fontSize: 18, color: "var(--text-primary)", fontWeight: 700, marginBottom: 12 }}>{fmt(total, "currency", currency)}</div>
      {total === 0 ? (
        <div style={{ color: "var(--text-muted)", fontSize: 12 }}>No spend in this range</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map((it) => {
            const pct = total > 0 ? (it.value / total) * 100 : 0;
            return (
              <div key={it.name}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
                  <span style={{ color: "var(--text-primary)" }}>{it.name} <span style={{ color: "var(--text-secondary)" }}>({it.code})</span></span>
                  <span style={{ color: "var(--text-secondary)" }}>{fmt(it.value, "currency", currency)} · {pct.toFixed(0)}%</span>
                </div>
                <div style={{ height: 6, background: "var(--bg-input)", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: it.color }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Top campaigns table ─────────────────────────────────────────────────────

function CampaignTable({ rows, currency }: { rows: OverviewCampaignRow[]; currency: string }) {
  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: 20 }}>
      <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 12 }}>Top 10 Campaigns by Spend</h3>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--text-secondary)" }}>
              <Th>Type</Th><Th>Status</Th><Th align="left">Campaign</Th>
              <Th align="right">Budget</Th><Th align="right">Spend</Th><Th align="right">Sales</Th>
              <Th align="right">Orders</Th><Th align="right">ROAS</Th><Th align="right">ACOS</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} style={{ borderBottom: "1px solid var(--bg-input)" }}>
                <Td><Pill text={c.type} /></Td>
                <Td><Pill text={c.status} muted={c.status !== "ENABLED"} /></Td>
                <Td title={c.name} style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <Link href={`/master-overview/campaign/${c.id}`} style={{ color: "var(--c-indigo-text)", textDecoration: "none" }}>{c.name}</Link>
                </Td>
                <Td align="right" style={{ color: "var(--text-secondary)" }}>{fmt(c.budget, "currency", currency)}</Td>
                <Td align="right" style={{ color: "var(--text-primary)" }}>{fmt(c.spend, "currency", currency)}</Td>
                <Td align="right" style={{ color: "var(--text-primary)" }}>{fmt(c.sales, "currency", currency)}</Td>
                <Td align="right" style={{ color: "var(--text-secondary)" }}>{c.orders}</Td>
                <Td align="right" style={{ color: c.roas >= 2 ? "#22c55e" : c.roas >= 1 ? "#f59e0b" : "#ef4444" }}>{c.roas.toFixed(2)}x</Td>
                <Td align="right" style={{ color: c.acos > 0 && c.acos <= 25 ? "#22c55e" : c.acos > 25 ? "#ef4444" : "var(--text-muted)" }}>{c.acos.toFixed(1)}%</Td>
              </tr>
            ))}
          </tbody>
        </table>
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
function btnGhost(disabled: boolean): React.CSSProperties {
  return {
    padding: "6px 12px", borderRadius: 6, background: "var(--bg-input)",
    border: "1px solid var(--border)", color: disabled ? "var(--text-muted)" : "var(--text-secondary)",
    cursor: disabled ? "default" : "pointer", fontSize: 12,
    display: "inline-flex", alignItems: "center", gap: 5,
  };
}
function btnPrimary(disabled: boolean): React.CSSProperties {
  return {
    padding: "6px 12px", borderRadius: 6,
    background: disabled ? "var(--bg-input)" : "linear-gradient(135deg,#6366f1,#8b5cf6)",
    border: "1px solid",
    borderColor: disabled ? "var(--border)" : "transparent",
    color: disabled ? "var(--text-muted)" : "#fff",
    cursor: disabled ? "default" : "pointer", fontSize: 12, fontWeight: 600,
  };
}
function humanTime(iso: string): string {
  try {
    const d = new Date(iso);
    const mins = Math.round((Date.now() - d.getTime()) / 60_000);
    if (mins < 1)   return "just now";
    if (mins < 60)  return `${mins} min ago`;
    if (mins < 24*60) return `${Math.round(mins/60)} h ago`;
    return d.toLocaleString();
  } catch { return iso; }
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
