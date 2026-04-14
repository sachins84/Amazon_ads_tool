"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import TopNav from "@/components/shared/TopNav";
import MockBanner from "@/components/shared/MockBanner";
import { TableRowSkeleton } from "@/components/shared/Skeleton";
import { fetchBrandAnalytics, type BrandAnalyticsData } from "@/lib/api-client";
import { useAccount } from "@/lib/account-context";
import { fmt } from "@/lib/utils";
import type {
  SearchTermRow,
  SQPRow,
  CatalogPerformanceRow,
} from "@/lib/types";

type SubTab = "search-terms" | "sqp" | "catalog";

const SUB_TABS: { key: SubTab; label: string; desc: string }[] = [
  { key: "search-terms", label: "Search Terms", desc: "SFR + Top Clicked/Purchased ASINs" },
  { key: "sqp",          label: "Brand & Product Performance", desc: "Brand-wise top ASINs — funnel metrics & WoW trends" },
  { key: "catalog",      label: "Catalog Performance", desc: "ASIN-level performance with trend bars" },
];

export default function BrandAnalyticsPage() {
  const [subTab, setSubTab]       = useState<SubTab>("search-terms");
  const [dateRange, setDateRange] = useState("Last 30D");
  const [search, setSearch]       = useState("");

  const [data, setData]       = useState<BrandAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [isMock, setIsMock]   = useState(false);

  // Sort state
  const [sortCol, setSortCol] = useState<string>("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const { activeAccount } = useAccount();
  const accountId = activeAccount?.id ?? "";

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchBrandAnalytics({
        accountId: accountId || undefined,
        dateRange,
        signal,
        onUpdate: (liveData) => {
          if (signal?.aborted) return;
          setData(liveData);
          setIsMock(liveData._source === "mock");
          setLoading(false);
        },
      });
      if (!signal?.aborted) {
        setData(result);
        setIsMock(result._source === "mock");
        setLoading(false);
      }
    } catch (e) {
      if (!signal?.aborted) {
        setError(String(e));
        setLoading(false);
      }
    }
  }, [accountId, dateRange]);

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [load]);

  // Reset sort when switching tabs
  useEffect(() => { setSortCol(""); setSortDir("asc"); setSearch(""); }, [subTab]);

  return (
    <div style={{ minHeight: "100vh", background: "#0d1117" }}>
      <TopNav />

      <main style={{ padding: "24px 28px", maxWidth: 1800, margin: "0 auto" }}>
        {/* Page header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: 20, flexWrap: "wrap", gap: 12,
        }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: "#e2e8f0", letterSpacing: "-0.4px" }}>
              Brand Analytics
            </h1>
            <p style={{ fontSize: 12, color: "#8892a4", marginTop: 2 }}>
              Amazon Brand Analytics reports — search terms, query performance & catalog insights
            </p>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              style={{
                background: "#1c2333", border: "1px solid #2a3245", borderRadius: 6,
                color: "#e2e8f0", padding: "6px 10px", fontSize: 12, cursor: "pointer",
              }}
            >
              {["Last 7D", "Last 14D", "Last 30D", "This Month", "Last Month"].map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>

            <button
              onClick={() => load()}
              disabled={loading}
              style={{
                padding: "6px 12px", borderRadius: 6,
                background: "#1c2333", border: "1px solid #2a3245",
                color: loading ? "#555f6e" : "#8892a4",
                cursor: loading ? "default" : "pointer", fontSize: 12,
                display: "flex", alignItems: "center", gap: 5,
              }}
            >
              <span style={{ display: "inline-block", animation: loading ? "spin 1s linear infinite" : "none" }}>&#8635;</span>
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>
        </div>

        {isMock && !loading && (
          <MockBanner message="Brand Analytics requires SP-API credentials with Brand Registry access. Configure SP_API_REFRESH_TOKEN in .env.local to connect live data." />
        )}

        {error && (
          <div style={{
            background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)",
            borderRadius: 8, padding: "12px 16px", marginBottom: 16,
            fontSize: 13, color: "#ef4444",
          }}>
            {error}
            <button onClick={() => load()} style={{ marginLeft: 12, color: "#6366f1", background: "transparent", border: "none", cursor: "pointer", fontSize: 12 }}>
              Retry
            </button>
          </div>
        )}

        {/* Sub-tab navigation */}
        <div style={{
          display: "flex", gap: 4, marginBottom: 16,
          borderBottom: "1px solid #2a3245", paddingBottom: 0,
        }}>
          {SUB_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setSubTab(t.key)}
              style={{
                padding: "10px 18px",
                borderRadius: "8px 8px 0 0",
                fontSize: 13,
                fontWeight: subTab === t.key ? 600 : 400,
                color: subTab === t.key ? "#e2e8f0" : "#8892a4",
                background: subTab === t.key ? "#161b27" : "transparent",
                border: subTab === t.key ? "1px solid #2a3245" : "1px solid transparent",
                borderBottom: subTab === t.key ? "1px solid #161b27" : "1px solid transparent",
                marginBottom: -1,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Sub-tab description */}
        <p style={{ fontSize: 12, color: "#555f6e", marginBottom: 12 }}>
          {SUB_TABS.find((t) => t.key === subTab)?.desc}
        </p>

        {/* Search filter */}
        <div style={{ marginBottom: 14 }}>
          <input
            type="text"
            placeholder={subTab === "catalog" ? "Search by ASIN or keyword..." : "Search keywords..."}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              background: "#1c2333", border: "1px solid #2a3245", borderRadius: 6,
              color: "#e2e8f0", padding: "7px 12px", fontSize: 12, width: 320,
              outline: "none",
            }}
          />
        </div>

        {/* Table content */}
        {loading ? (
          <div style={{ background: "#161b27", border: "1px solid #2a3245", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ padding: "10px 16px", borderBottom: "1px solid #2a3245", background: "#0d1117" }}>
              <div style={{ height: 12, width: 200, background: "#1c2333", borderRadius: 4 }} />
            </div>
            <table style={{ width: "100%" }}>
              <tbody>
                {Array.from({ length: 12 }).map((_, i) => <TableRowSkeleton key={i} cols={10} />)}
              </tbody>
            </table>
          </div>
        ) : (
          <>
            {subTab === "search-terms" && data && (
              <SearchTermsTable
                rows={data.searchTerms}
                search={search}
                sortCol={sortCol}
                sortDir={sortDir}
                onSort={(col) => {
                  if (sortCol === col) setSortDir((d) => d === "asc" ? "desc" : "asc");
                  else { setSortCol(col); setSortDir("asc"); }
                }}
              />
            )}
            {subTab === "sqp" && data && (
              <BrandProductView
                rows={data.catalogPerformance}
                prevRows={data.previousCatalog ?? []}
                weeklyTrends={data.weeklyTrends ?? {}}
                periodLabel={data.periodLabel ?? "WoW"}
                search={search}
              />
            )}
            {subTab === "catalog" && data && (
              <CatalogTable
                rows={data.catalogPerformance}
                prevRows={data.previousCatalog ?? []}
                periodLabel={data.periodLabel ?? "WoW"}
                search={search}
                sortCol={sortCol}
                sortDir={sortDir}
                onSort={(col) => {
                  if (sortCol === col) setSortDir((d) => d === "asc" ? "desc" : "asc");
                  else { setSortCol(col); setSortDir("asc"); }
                }}
              />
            )}
          </>
        )}
      </main>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── Shared table helpers ────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  padding: "10px 12px",
  fontSize: 11,
  fontWeight: 600,
  color: "#8892a4",
  textAlign: "left",
  borderBottom: "1px solid #2a3245",
  background: "#0d1117",
  cursor: "pointer",
  userSelect: "none",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "9px 12px",
  fontSize: 12,
  color: "#e2e8f0",
  borderBottom: "1px solid #1c2333",
  whiteSpace: "nowrap",
};

const numTd: React.CSSProperties = { ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" };

/** SVG sparkline for trend data */
function Sparkline({ data, color, width = 160, height = 40 }: { data: number[]; color: string; width?: number; height?: number }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const pad = 4;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const points = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * w;
    const y = pad + h - ((v - min) / range) * h;
    return `${x},${y}`;
  });
  // Gradient fill under the line
  const fillPoints = [...points, `${pad + w},${pad + h}`, `${pad},${pad + h}`];
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <defs>
        <linearGradient id={`sg-${color.replace("#","")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <polygon points={fillPoints.join(" ")} fill={`url(#sg-${color.replace("#","")})`} />
      <polyline points={points.join(" ")} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {data.map((v, i) => {
        const x = pad + (i / (data.length - 1)) * w;
        const y = pad + h - ((v - min) / range) * h;
        return <circle key={i} cx={x} cy={y} r={i === data.length - 1 ? 3.5 : 2} fill={i === data.length - 1 ? color : "#1c2333"} stroke={color} strokeWidth="1.5" />;
      })}
    </svg>
  );
}

/** Magnifying glass icon — click to see multi-week trendline popup */
function TrendIcon({ trendData, label, periodLabel, suffix }: {
  trendData: number[];
  label: string;
  periodLabel?: string;
  suffix?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!trendData || trendData.length < 2) return null;
  const current = trendData[trendData.length - 1];
  const previous = trendData[trendData.length - 2];
  const delta = previous > 0 ? ((current - previous) / previous * 100) : 0;
  const up = delta > 0;
  const weekLabels = trendData.map((_, i) => `W${i - trendData.length + 1}`).map((l, i, a) => i === a.length - 1 ? "Now" : l);
  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        style={{
          background: "transparent", border: "none", cursor: "pointer", padding: "0 2px",
          color: "#555f6e", fontSize: 11, lineHeight: 1, verticalAlign: "middle",
        }}
        title={`${periodLabel ?? "WoW"} trend for ${label}`}
      >
        {"\uD83D\uDD0D"}
      </button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute", bottom: "100%", right: 0, marginBottom: 6,
            background: "#1c2333", border: "1px solid #2a3245", borderRadius: 10,
            padding: "12px 16px", zIndex: 100, minWidth: 240,
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0" }}>{label}</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: up ? "#22c55e" : "#ef4444" }}>
              {up ? "\u2191" : "\u2193"}{Math.abs(delta).toFixed(1)}% {periodLabel ?? "WoW"}
            </span>
          </div>
          {/* Sparkline chart */}
          <Sparkline data={trendData} color={up ? "#22c55e" : "#ef4444"} width={210} height={50} />
          {/* Week labels */}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 9, color: "#555f6e" }}>
            {weekLabels.map((l, i) => <span key={i}>{l}</span>)}
          </div>
          {/* Values row */}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2, fontSize: 10, color: "#8892a4" }}>
            {trendData.map((v, i) => <span key={i} style={{ fontWeight: i === trendData.length - 1 ? 600 : 400, color: i === trendData.length - 1 ? "#e2e8f0" : "#8892a4" }}>{fmt(v, v >= 1000 ? "compact" : "number")}{suffix ?? ""}</span>)}
          </div>
          {/* Close */}
          <button onClick={(e) => { e.stopPropagation(); setOpen(false); }} style={{ position: "absolute", top: 6, right: 8, background: "transparent", border: "none", color: "#555f6e", cursor: "pointer", fontSize: 12 }}>x</button>
        </div>
      )}
    </span>
  );
}

/** Inline horizontal bar showing value relative to max — gives visual trend across rows */
function MetricBar({ value, max, color, label }: { value: number; max: number; color: string; label: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
      <span style={{ fontSize: 12, color: "#e2e8f0", fontVariantNumeric: "tabular-nums", minWidth: 36, textAlign: "right" }}>{label}</span>
      <div style={{ width: 50, height: 6, borderRadius: 3, background: "#1c2333", overflow: "hidden", flexShrink: 0 }}>
        <div style={{ width: `${pct}%`, height: "100%", borderRadius: 3, background: color, transition: "width 0.3s" }} />
      </div>
    </div>
  );
}
const numTh: React.CSSProperties = { ...thStyle, textAlign: "right" };

function SortArrow({ col, sortCol, sortDir }: { col: string; sortCol: string; sortDir: "asc" | "desc" }) {
  if (col !== sortCol) return <span style={{ color: "#555f6e", marginLeft: 4 }}>&uarr;&darr;</span>;
  return <span style={{ color: "#6366f1", marginLeft: 4 }}>{sortDir === "asc" ? "\u2191" : "\u2193"}</span>;
}

function SfrBadge({ rank }: { rank: number }) {
  const color = rank <= 500 ? "#22c55e" : rank <= 2000 ? "#f59e0b" : rank <= 5000 ? "#8892a4" : "#555f6e";
  const bg = rank <= 500 ? "rgba(34,197,94,0.12)" : rank <= 2000 ? "rgba(245,158,11,0.12)" : "rgba(85,95,110,0.08)";
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 4,
      fontSize: 11, fontWeight: 600, color, background: bg,
      fontVariantNumeric: "tabular-nums",
    }}>
      #{rank.toLocaleString()}
    </span>
  );
}

function ShareBar({ value, color }: { value: number; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
      <span style={{ fontSize: 12, color: "#e2e8f0", fontVariantNumeric: "tabular-nums", minWidth: 40, textAlign: "right" }}>
        {value.toFixed(1)}%
      </span>
      <div style={{ width: 60, height: 6, borderRadius: 3, background: "#1c2333", overflow: "hidden" }}>
        <div style={{ width: `${Math.min(value, 100)}%`, height: "100%", borderRadius: 3, background: color }} />
      </div>
    </div>
  );
}

function sortRows<T>(rows: T[], col: string, dir: "asc" | "desc"): T[] {
  if (!col) return rows;
  return [...rows].sort((a, b) => {
    const av = (a as Record<string, unknown>)[col];
    const bv = (b as Record<string, unknown>)[col];
    if (typeof av === "number" && typeof bv === "number") return dir === "asc" ? av - bv : bv - av;
    return dir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
  });
}

// ─── Search Terms Table ──────────────────────────────────────────────────────

function SearchTermsTable({
  rows, search, sortCol, sortDir, onSort,
}: {
  rows: SearchTermRow[];
  search: string;
  sortCol: string;
  sortDir: "asc" | "desc";
  onSort: (col: string) => void;
}) {
  const filtered = useMemo(() => {
    let r = rows;
    if (search) {
      const q = search.toLowerCase();
      r = r.filter((row) =>
        row.searchTerm.toLowerCase().includes(q) ||
        row.asin1.toLowerCase().includes(q) ||
        row.asin2.toLowerCase().includes(q) ||
        row.asin3.toLowerCase().includes(q)
      );
    }
    return sortRows(r, sortCol, sortDir);
  }, [rows, search, sortCol, sortDir]);

  return (
    <div style={{ background: "#161b27", border: "1px solid #2a3245", borderRadius: 10, overflow: "hidden" }}>
      <div style={{ padding: "10px 16px", borderBottom: "1px solid #2a3245", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "#8892a4" }}>
          <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{filtered.length.toLocaleString()}</span> search terms
        </span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle} onClick={() => onSort("searchTerm")}>Search Term<SortArrow col="searchTerm" sortCol={sortCol} sortDir={sortDir} /></th>
              <th style={numTh} onClick={() => onSort("searchFrequencyRank")}>SFR<SortArrow col="searchFrequencyRank" sortCol={sortCol} sortDir={sortDir} /></th>
              <th style={thStyle} onClick={() => onSort("asin1")}>#1 ASIN<SortArrow col="asin1" sortCol={sortCol} sortDir={sortDir} /></th>
              <th style={numTh} onClick={() => onSort("asin1ClickShare")}>Click %<SortArrow col="asin1ClickShare" sortCol={sortCol} sortDir={sortDir} /></th>
              <th style={numTh} onClick={() => onSort("asin1ConversionShare")}>Conv %<SortArrow col="asin1ConversionShare" sortCol={sortCol} sortDir={sortDir} /></th>
              <th style={thStyle} onClick={() => onSort("asin2")}>#2 ASIN<SortArrow col="asin2" sortCol={sortCol} sortDir={sortDir} /></th>
              <th style={numTh} onClick={() => onSort("asin2ClickShare")}>Click %<SortArrow col="asin2ClickShare" sortCol={sortCol} sortDir={sortDir} /></th>
              <th style={numTh} onClick={() => onSort("asin2ConversionShare")}>Conv %<SortArrow col="asin2ConversionShare" sortCol={sortCol} sortDir={sortDir} /></th>
              <th style={thStyle} onClick={() => onSort("asin3")}>#3 ASIN<SortArrow col="asin3" sortCol={sortCol} sortDir={sortDir} /></th>
              <th style={numTh} onClick={() => onSort("asin3ClickShare")}>Click %<SortArrow col="asin3ClickShare" sortCol={sortCol} sortDir={sortDir} /></th>
              <th style={numTh} onClick={() => onSort("asin3ConversionShare")}>Conv %<SortArrow col="asin3ConversionShare" sortCol={sortCol} sortDir={sortDir} /></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "rgba(28,35,51,0.3)" }}>
                <td style={{ ...tdStyle, fontWeight: 500, maxWidth: 260 }}>
                  <span style={{ display: "inline-block", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis" }}>{row.searchTerm}</span>
                </td>
                <td style={numTd}><SfrBadge rank={row.searchFrequencyRank} /></td>
                <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: 11, color: "#a78bfa" }}>{row.asin1}</td>
                <td style={numTd}><ShareBar value={row.asin1ClickShare} color="#6366f1" /></td>
                <td style={numTd}><ShareBar value={row.asin1ConversionShare} color="#22c55e" /></td>
                <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: 11, color: "#a78bfa" }}>{row.asin2}</td>
                <td style={numTd}><ShareBar value={row.asin2ClickShare} color="#6366f1" /></td>
                <td style={numTd}><ShareBar value={row.asin2ConversionShare} color="#22c55e" /></td>
                <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: 11, color: "#a78bfa" }}>{row.asin3}</td>
                <td style={numTd}><ShareBar value={row.asin3ClickShare} color="#6366f1" /></td>
                <td style={numTd}><ShareBar value={row.asin3ConversionShare} color="#22c55e" /></td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={11} style={{ ...tdStyle, textAlign: "center", color: "#555f6e", padding: 32 }}>No search terms found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Brand & Product Performance View ────────────────────────────────────────

const BRAND_COLORS: Record<string, string> = {
  "Man Matters": "#6366f1",
  "Be Bodywise": "#ec4899",
  "Little Joys": "#f59e0b",
  "Bodywise": "#8b5cf6",
};

interface BrandSummary {
  brand: string;
  impressions: number;
  clicks: number;
  addToCarts: number;
  purchases: number;
  asinCount: number;
  prevImpressions: number;
  prevClicks: number;
  prevAddToCarts: number;
  prevPurchases: number;
}

function BrandProductView({
  rows, prevRows, weeklyTrends, periodLabel, search,
}: {
  rows: CatalogPerformanceRow[];
  prevRows: CatalogPerformanceRow[];
  weeklyTrends: Record<string, import("@/lib/types").AsinWeeklyTrend>;
  periodLabel: string;
  search: string;
}) {
  const [expandedBrand, setExpandedBrand] = useState<string | null>(null);

  // Previous period map by ASIN
  const prevMap = useMemo(() => {
    const m = new Map<string, CatalogPerformanceRow>();
    for (const r of prevRows) m.set(r.asin, r);
    return m;
  }, [prevRows]);

  // Aggregate by brand
  const brandData = useMemo(() => {
    const map = new Map<string, BrandSummary>();
    for (const row of rows) {
      const b = row.brandName || "Other";
      const existing = map.get(b);
      if (existing) {
        existing.impressions += row.impressions;
        existing.clicks += row.clicks;
        existing.addToCarts += row.addToCarts;
        existing.purchases += row.purchases;
        existing.asinCount += 1;
      } else {
        map.set(b, { brand: b, impressions: row.impressions, clicks: row.clicks, addToCarts: row.addToCarts, purchases: row.purchases, asinCount: 1, prevImpressions: 0, prevClicks: 0, prevAddToCarts: 0, prevPurchases: 0 });
      }
    }
    // Aggregate previous period by brand
    for (const row of prevRows) {
      const b = row.brandName || "Other";
      const existing = map.get(b);
      if (existing) {
        existing.prevImpressions += row.impressions;
        existing.prevClicks += row.clicks;
        existing.prevAddToCarts += row.addToCarts;
        existing.prevPurchases += row.purchases;
      }
    }
    // Sort: known brands first, then by purchases desc
    const known = ["Man Matters", "Be Bodywise", "Little Joys"];
    return Array.from(map.values()).sort((a, b) => {
      const ai = known.indexOf(a.brand);
      const bi = known.indexOf(b.brand);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return b.purchases - a.purchases;
    });
  }, [rows, prevRows]);

  // Products per brand sorted by purchases
  const brandProducts = useMemo(() => {
    const map = new Map<string, CatalogPerformanceRow[]>();
    for (const row of rows) {
      const b = row.brandName || "Other";
      const arr = map.get(b) ?? [];
      arr.push(row);
      map.set(b, arr);
    }
    for (const [k, v] of map) map.set(k, v.sort((a, b) => b.purchases - a.purchases));
    return map;
  }, [rows]);

  // Total across all brands (for market share)
  const totals = useMemo(() => {
    return rows.reduce((acc, r) => ({
      impressions: acc.impressions + r.impressions,
      clicks: acc.clicks + r.clicks,
      addToCarts: acc.addToCarts + r.addToCarts,
      purchases: acc.purchases + r.purchases,
    }), { impressions: 0, clicks: 0, addToCarts: 0, purchases: 0 });
  }, [rows]);

  const filteredBrands = useMemo(() => {
    if (!search) return brandData;
    const q = search.toLowerCase();
    return brandData.filter((b) => b.brand.toLowerCase().includes(q));
  }, [brandData, search]);

  return (
    <>
      {/* Brand summary cards */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        {filteredBrands.filter((b) => b.brand !== "Other").map((b) => {
          const color = BRAND_COLORS[b.brand] ?? "#8892a4";
          const cvr = b.impressions > 0 ? (b.purchases / b.impressions * 100) : 0;
          const atcPct = b.impressions > 0 ? (b.addToCarts / b.impressions * 100) : 0;
          const pPct = b.addToCarts > 0 ? (b.purchases / b.addToCarts * 100) : 0;
          const mktShare = totals.purchases > 0 ? (b.purchases / totals.purchases * 100) : 0;
          const isExpanded = expandedBrand === b.brand;
          return (
            <div key={b.brand}
              onClick={() => setExpandedBrand(isExpanded ? null : b.brand)}
              style={{
                background: isExpanded ? "rgba(99,102,241,0.08)" : "#161b27",
                border: `1px solid ${isExpanded ? color + "60" : "#2a3245"}`,
                borderRadius: 10, padding: "14px 18px", minWidth: 260, cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: color, flexShrink: 0 }} />
                <span style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0" }}>{b.brand}</span>
                <span style={{ fontSize: 11, color: "#555f6e", marginLeft: "auto" }}>{b.asinCount} ASINs</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "8px 16px", fontSize: 11 }}>
                <div>
                  <div style={{ color: "#555f6e" }}>Page Views</div>
                  <div style={{ color: "#e2e8f0", fontWeight: 600 }}>{fmt(b.impressions, "compact")}<DeltaBadge current={b.impressions} previous={b.prevImpressions} /></div>
                </div>
                <div>
                  <div style={{ color: "#555f6e" }}>Clicks</div>
                  <div style={{ color: "#e2e8f0", fontWeight: 600 }}>{fmt(b.clicks, "compact")}<DeltaBadge current={b.clicks} previous={b.prevClicks} /></div>
                </div>
                <div>
                  <div style={{ color: "#555f6e" }}>ATC</div>
                  <div style={{ color: "#e2e8f0", fontWeight: 600 }}>{fmt(b.addToCarts, "number")}<DeltaBadge current={b.addToCarts} previous={b.prevAddToCarts} /></div>
                </div>
                <div>
                  <div style={{ color: "#555f6e" }}>Purchases</div>
                  <div style={{ color: "#e2e8f0", fontWeight: 600 }}>{b.purchases}<DeltaBadge current={b.purchases} previous={b.prevPurchases} /></div>
                </div>
                <div>
                  <div style={{ color: "#555f6e" }}>CVR</div>
                  <div style={{ color: cvr > 0.5 ? "#22c55e" : "#f59e0b", fontWeight: 600 }}>{cvr.toFixed(2)}%</div>
                </div>
                <div>
                  <div style={{ color: "#555f6e" }}>ATC %</div>
                  <div style={{ color: "#e2e8f0", fontWeight: 600 }}>{atcPct.toFixed(1)}%</div>
                </div>
                <div>
                  <div style={{ color: "#555f6e" }}>%P (P/ATC)</div>
                  <div style={{ color: pPct > 40 ? "#22c55e" : "#f59e0b", fontWeight: 600 }}>{pPct.toFixed(1)}%</div>
                </div>
                <div>
                  <div style={{ color: "#555f6e" }}>Mkt Share</div>
                  <div style={{ color: "#6366f1", fontWeight: 600 }}>{mktShare.toFixed(1)}%</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Expanded brand: top products table */}
      {expandedBrand && (
        <BrandProductsTable
          brand={expandedBrand}
          products={brandProducts.get(expandedBrand) ?? []}
          prevMap={prevMap}
          weeklyTrends={weeklyTrends}
          periodLabel={periodLabel}
          color={BRAND_COLORS[expandedBrand] ?? "#8892a4"}
          totals={totals}
        />
      )}

      {/* If no brand expanded, show all top products across brands */}
      {!expandedBrand && (
        <div style={{ background: "#161b27", border: "1px solid #2a3245", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ padding: "10px 16px", borderBottom: "1px solid #2a3245" }}>
            <span style={{ fontSize: 12, color: "#8892a4" }}>
              Click a brand card above to see its top products, or view <span style={{ color: "#e2e8f0", fontWeight: 600 }}>all top products</span> below
            </span>
          </div>
          <AllBrandsTable rows={rows} prevMap={prevMap} weeklyTrends={weeklyTrends} search={search} periodLabel={periodLabel} />
        </div>
      )}
    </>
  );
}

function BrandProductsTable({ brand, products, prevMap, weeklyTrends, periodLabel, color, totals }: {
  brand: string;
  products: CatalogPerformanceRow[];
  prevMap: Map<string, CatalogPerformanceRow>;
  weeklyTrends: Record<string, import("@/lib/types").AsinWeeklyTrend>;
  periodLabel: string;
  color: string;
  totals: { impressions: number; clicks: number; purchases: number };
}) {
  const maxImpr = Math.max(...products.map((r) => r.impressions), 1);
  return (
    <div style={{ background: "#161b27", border: `1px solid ${color}40`, borderRadius: 10, overflow: "hidden", marginBottom: 16 }}>
      <div style={{ padding: "10px 16px", borderBottom: "1px solid #2a3245", display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>{brand}</span>
        <span style={{ fontSize: 11, color: "#555f6e" }}>{products.length} products &middot; {periodLabel} trends</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, width: 40 }}>#</th>
              <th style={thStyle}>ASIN</th>
              <th style={thStyle}>Product</th>
              <th style={numTh}>Page Views</th>
              <th style={numTh}>Clicks</th>
              <th style={numTh}>ATC</th>
              <th style={numTh}>ATC %</th>
              <th style={numTh}>Purchases</th>
              <th style={numTh}>CVR</th>
              <th style={numTh}>%P</th>
              <th style={numTh}>View Shr</th>
              <th style={numTh}>Purch Shr</th>
            </tr>
          </thead>
          <tbody>
            {products.map((row, i) => {
              const prev = prevMap.get(row.asin);
              const cvr = row.impressions > 0 ? (row.purchases / row.impressions * 100) : 0;
              const atcPct = row.impressions > 0 ? (row.addToCarts / row.impressions * 100) : 0;
              const pPct = row.addToCarts > 0 ? (row.purchases / row.addToCarts * 100) : 0;
              const viewShr = totals.impressions > 0 ? (row.impressions / totals.impressions * 100) : 0;
              const purchShr = totals.purchases > 0 ? (row.purchases / totals.purchases * 100) : 0;
              return (
                <tr key={row.asin} style={{ background: i % 2 === 0 ? "transparent" : "rgba(28,35,51,0.3)" }}>
                  <td style={{ ...tdStyle, color: "#555f6e", textAlign: "center" }}>{i + 1}</td>
                  <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: 11, color: "#a78bfa" }}>{row.asin}</td>
                  <td style={{ ...tdStyle, maxWidth: 240 }}>
                    <span style={{ display: "inline-block", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {row.productTitle || "--"}
                    </span>
                  </td>
                  {(() => {
                    const t = weeklyTrends[row.asin];
                    return (<>
                      <td style={numTd}>
                        <MetricBar value={row.impressions} max={maxImpr} color={color} label={fmt(row.impressions, "compact")} />
                        {prev && <DeltaBadge current={row.impressions} previous={prev.impressions} />}
                        <TrendIcon trendData={t?.impressions ?? []} label="Page Views" periodLabel={periodLabel} />
                      </td>
                      <td style={numTd}>
                        {fmt(row.clicks, "number")}
                        {prev && <DeltaBadge current={row.clicks} previous={prev.clicks} />}
                        <TrendIcon trendData={t?.clicks ?? []} label="Clicks" periodLabel={periodLabel} />
                      </td>
                      <td style={numTd}>
                        {fmt(row.addToCarts, "number")}
                        {prev && <DeltaBadge current={row.addToCarts} previous={prev.addToCarts} />}
                        <TrendIcon trendData={t?.addToCarts ?? []} label="ATC" periodLabel={periodLabel} />
                      </td>
                      <td style={numTd}><span style={{ color: atcPct > 5 ? "#22c55e" : atcPct > 2 ? "#f59e0b" : "#555f6e" }}>{atcPct.toFixed(1)}%</span></td>
                      <td style={numTd}>
                        {row.purchases}
                        {prev && <DeltaBadge current={row.purchases} previous={prev.purchases} />}
                        <TrendIcon trendData={t?.purchases ?? []} label="Purchases" periodLabel={periodLabel} />
                      </td>
                      <td style={numTd}><span style={{ color: cvr > 0.5 ? "#22c55e" : cvr > 0.2 ? "#f59e0b" : "#555f6e" }}>{cvr.toFixed(2)}%</span></td>
                      <td style={numTd}><span style={{ color: pPct > 40 ? "#22c55e" : pPct > 20 ? "#f59e0b" : "#555f6e" }}>{pPct.toFixed(1)}%</span></td>
                      <td style={numTd}>
                        <ShareBar value={viewShr} color="#6366f1" />
                        <TrendIcon trendData={t?.impressions.map((v, i) => { const tot = Object.values(weeklyTrends).reduce((s, wt) => s + (wt.impressions[i] ?? 0), 0); return tot > 0 ? v / tot * 100 : 0; }) ?? []} label="View Share" periodLabel={periodLabel} suffix="%" />
                      </td>
                      <td style={numTd}>
                        <ShareBar value={purchShr} color="#22c55e" />
                        <TrendIcon trendData={t?.purchases.map((v, i) => { const tot = Object.values(weeklyTrends).reduce((s, wt) => s + (wt.purchases[i] ?? 0), 0); return tot > 0 ? v / tot * 100 : 0; }) ?? []} label="Purchase Share" periodLabel={periodLabel} suffix="%" />
                      </td>
                    </>);
                  })()}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AllBrandsTable({ rows, prevMap, weeklyTrends, search, periodLabel }: {
  rows: CatalogPerformanceRow[];
  prevMap: Map<string, CatalogPerformanceRow>;
  weeklyTrends: Record<string, import("@/lib/types").AsinWeeklyTrend>;
  search: string;
  periodLabel: string;
}) {
  const filtered = useMemo(() => {
    let r = [...rows].sort((a, b) => b.purchases - a.purchases).slice(0, 50);
    if (search) {
      const q = search.toLowerCase();
      r = r.filter((row) => row.asin.toLowerCase().includes(q) || row.productTitle.toLowerCase().includes(q) || row.brandName.toLowerCase().includes(q));
    }
    return r;
  }, [rows, search]);

  const totalImpr = rows.reduce((s, r) => s + r.impressions, 0);
  const totalPurch = rows.reduce((s, r) => s + r.purchases, 0);

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ ...thStyle, width: 40 }}>#</th>
            <th style={thStyle}>Brand</th>
            <th style={thStyle}>ASIN</th>
            <th style={thStyle}>Product</th>
            <th style={numTh}>Page Views</th>
            <th style={numTh}>Clicks</th>
            <th style={numTh}>ATC</th>
            <th style={numTh}>Purchases</th>
            <th style={numTh}>CVR</th>
            <th style={numTh}>%P</th>
            <th style={numTh}>View Shr</th>
            <th style={numTh}>Purch Shr</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((row, i) => {
            const prev = prevMap.get(row.asin);
            const cvr = row.impressions > 0 ? (row.purchases / row.impressions * 100) : 0;
            const pPct = row.addToCarts > 0 ? (row.purchases / row.addToCarts * 100) : 0;
            const brandColor = BRAND_COLORS[row.brandName] ?? "#555f6e";
            const viewShr = totalImpr > 0 ? (row.impressions / totalImpr * 100) : 0;
            const purchShr = totalPurch > 0 ? (row.purchases / totalPurch * 100) : 0;
            return (
              <tr key={row.asin} style={{ background: i % 2 === 0 ? "transparent" : "rgba(28,35,51,0.3)" }}>
                <td style={{ ...tdStyle, color: "#555f6e", textAlign: "center" }}>{i + 1}</td>
                <td style={{ ...tdStyle, fontSize: 11 }}>
                  {row.brandName ? (
                    <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 500, background: brandColor + "18", color: brandColor }}>{row.brandName}</span>
                  ) : <span style={{ color: "#555f6e" }}>--</span>}
                </td>
                <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: 11, color: "#a78bfa" }}>{row.asin}</td>
                <td style={{ ...tdStyle, maxWidth: 200 }}>
                  <span style={{ display: "inline-block", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.productTitle || "--"}</span>
                </td>
                {(() => {
                  const t = weeklyTrends[row.asin];
                  return (<>
                    <td style={numTd}>
                      {fmt(row.impressions, "compact")}
                      {prev && <DeltaBadge current={row.impressions} previous={prev.impressions} />}
                      <TrendIcon trendData={t?.impressions ?? []} label="Page Views" periodLabel={periodLabel} />
                    </td>
                    <td style={numTd}>
                      {fmt(row.clicks, "number")}
                      {prev && <DeltaBadge current={row.clicks} previous={prev.clicks} />}
                      <TrendIcon trendData={t?.clicks ?? []} label="Clicks" periodLabel={periodLabel} />
                    </td>
                    <td style={numTd}>
                      {fmt(row.addToCarts, "number")}
                      {prev && <DeltaBadge current={row.addToCarts} previous={prev.addToCarts} />}
                      <TrendIcon trendData={t?.addToCarts ?? []} label="ATC" periodLabel={periodLabel} />
                    </td>
                    <td style={numTd}>
                      {row.purchases}
                      {prev && <DeltaBadge current={row.purchases} previous={prev.purchases} />}
                      <TrendIcon trendData={t?.purchases ?? []} label="Purchases" periodLabel={periodLabel} />
                    </td>
                    <td style={numTd}><span style={{ color: cvr > 0.5 ? "#22c55e" : cvr > 0.2 ? "#f59e0b" : "#555f6e" }}>{cvr.toFixed(2)}%</span></td>
                    <td style={numTd}><span style={{ color: pPct > 40 ? "#22c55e" : pPct > 20 ? "#f59e0b" : "#555f6e" }}>{pPct.toFixed(1)}%</span></td>
                    <td style={numTd}>
                      <ShareBar value={viewShr} color="#6366f1" />
                      <TrendIcon trendData={t?.impressions.map((v, i) => { const tot = Object.values(weeklyTrends).reduce((s, wt) => s + (wt.impressions[i] ?? 0), 0); return tot > 0 ? v / tot * 100 : 0; }) ?? []} label="View Share" periodLabel={periodLabel} suffix="%" />
                    </td>
                    <td style={numTd}>
                      <ShareBar value={purchShr} color="#22c55e" />
                      <TrendIcon trendData={t?.purchases.map((v, i) => { const tot = Object.values(weeklyTrends).reduce((s, wt) => s + (wt.purchases[i] ?? 0), 0); return tot > 0 ? v / tot * 100 : 0; }) ?? []} label="Purchase Share" periodLabel={periodLabel} suffix="%" />
                    </td>
                  </>);
                })()}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Catalog Performance Table ───────────────────────────────────────────────

function DeltaBadge({ current, previous, suffix }: { current: number; previous: number; suffix?: string }) {
  if (!previous) return null;
  const delta = previous > 0 ? ((current - previous) / previous * 100) : 0;
  if (Math.abs(delta) < 0.1) return null;
  const up = delta > 0;
  return (
    <span style={{
      fontSize: 10, fontWeight: 500, marginLeft: 4,
      color: up ? "#22c55e" : "#ef4444",
    }}>
      {up ? "\u2191" : "\u2193"}{Math.abs(delta).toFixed(1)}%{suffix ? ` ${suffix}` : ""}
    </span>
  );
}

function CatalogTable({
  rows, prevRows, periodLabel, search, sortCol, sortDir, onSort,
}: {
  rows: CatalogPerformanceRow[];
  prevRows: CatalogPerformanceRow[];
  periodLabel: string;
  search: string;
  sortCol: string;
  sortDir: "asc" | "desc";
  onSort: (col: string) => void;
}) {
  const [brandFilter, setBrandFilter] = useState("ALL");

  // Get unique brands for filter
  const brands = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) if (row.brandName) set.add(row.brandName);
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    let r = rows;
    if (brandFilter !== "ALL") r = r.filter((row) => row.brandName === brandFilter);
    if (search) {
      const q = search.toLowerCase();
      r = r.filter((row) =>
        row.asin.toLowerCase().includes(q) ||
        row.productTitle.toLowerCase().includes(q) ||
        row.brandName.toLowerCase().includes(q) ||
        row.searchQuery.toLowerCase().includes(q)
      );
    }
    return sortRows(r, sortCol, sortDir);
  }, [rows, search, sortCol, sortDir, brandFilter]);

  // Top ASINs summary
  const asinSummary = useMemo(() => {
    const src = brandFilter !== "ALL" ? filtered : rows;
    const map = new Map<string, { asin: string; title: string; brand: string; impressions: number; clicks: number; addToCarts: number; purchases: number }>();
    for (const row of src) {
      const e = map.get(row.asin);
      if (e) { e.impressions += row.impressions; e.clicks += row.clicks; e.addToCarts += row.addToCarts; e.purchases += row.purchases; }
      else map.set(row.asin, { asin: row.asin, title: row.productTitle, brand: row.brandName, impressions: row.impressions, clicks: row.clicks, addToCarts: row.addToCarts, purchases: row.purchases });
    }
    return Array.from(map.values()).sort((a, b) => b.purchases - a.purchases).slice(0, 5);
  }, [rows, filtered, brandFilter]);

  // Max values for relative bars
  const maxes = useMemo(() => ({
    impressions: Math.max(...filtered.map((r) => r.impressions), 1),
    clicks: Math.max(...filtered.map((r) => r.clicks), 1),
    addToCarts: Math.max(...filtered.map((r) => r.addToCarts), 1),
    purchases: Math.max(...filtered.map((r) => r.purchases), 1),
  }), [filtered]);

  // Map previous period data by ASIN for delta comparison
  const prevMap = useMemo(() => {
    const m = new Map<string, CatalogPerformanceRow>();
    for (const row of prevRows) m.set(row.asin, row);
    return m;
  }, [prevRows]);

  const hasPrev = prevRows.length > 0;

  return (
    <>
      {/* Period indicator */}
      {hasPrev && (
        <div style={{ fontSize: 11, color: "#8892a4", marginBottom: 8 }}>
          Showing <span style={{ color: "#6366f1", fontWeight: 600 }}>{periodLabel}</span> trends ({prevRows.length} ASINs in previous period)
        </div>
      )}

      {/* Brand market share summary */}
      {brands.length > 0 && (() => {
        const totalImpr = rows.reduce((s, r) => s + r.impressions, 0);
        const totalPurch = rows.reduce((s, r) => s + r.purchases, 0);
        return (
          <div style={{ display: "flex", gap: 8, marginBottom: 14, overflowX: "auto", paddingBottom: 4 }}>
            {brands.filter((b) => b !== "").map((b) => {
              const brandRows = rows.filter((r) => r.brandName === b);
              const bImpr = brandRows.reduce((s, r) => s + r.impressions, 0);
              const bPurch = brandRows.reduce((s, r) => s + r.purchases, 0);
              const imprShare = totalImpr > 0 ? (bImpr / totalImpr * 100) : 0;
              const purchShare = totalPurch > 0 ? (bPurch / totalPurch * 100) : 0;
              const color = BRAND_COLORS[b] ?? "#8892a4";
              return (
                <div key={b} style={{ background: "#161b27", border: "1px solid #2a3245", borderRadius: 8, padding: "8px 14px", minWidth: 150 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
                    <span style={{ fontSize: 11, fontWeight: 600, color: "#e2e8f0" }}>{b}</span>
                  </div>
                  <div style={{ display: "flex", gap: 12, fontSize: 10 }}>
                    <div>
                      <div style={{ color: "#555f6e" }}>View Share</div>
                      <div style={{ color: "#e2e8f0", fontWeight: 600, fontSize: 12 }}>{imprShare.toFixed(1)}%</div>
                    </div>
                    <div>
                      <div style={{ color: "#555f6e" }}>Purchase Share</div>
                      <div style={{ color: "#22c55e", fontWeight: 600, fontSize: 12 }}>{purchShare.toFixed(1)}%</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Brand filter pills */}
      {brands.length > 0 && (
        <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
          <button onClick={() => setBrandFilter("ALL")} style={{
            padding: "5px 14px", borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: "pointer",
            background: brandFilter === "ALL" ? "#6366f1" : "#1c2333",
            border: `1px solid ${brandFilter === "ALL" ? "#6366f1" : "#2a3245"}`,
            color: brandFilter === "ALL" ? "#fff" : "#8892a4",
          }}>All Brands</button>
          {brands.map((b) => (
            <button key={b} onClick={() => setBrandFilter(brandFilter === b ? "ALL" : b)} style={{
              padding: "5px 14px", borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: "pointer",
              background: brandFilter === b ? "#6366f1" : "#1c2333",
              border: `1px solid ${brandFilter === b ? "#6366f1" : "#2a3245"}`,
              color: brandFilter === b ? "#fff" : "#8892a4",
            }}>{b}</button>
          ))}
        </div>
      )}

      {/* Top ASINs summary cards */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, overflowX: "auto", paddingBottom: 4 }}>
        {asinSummary.map((a) => {
          const cvr = a.impressions > 0 ? (a.purchases / a.impressions * 100) : 0;
          const atcPct = a.impressions > 0 ? (a.addToCarts / a.impressions * 100) : 0;
          return (
            <div key={a.asin} style={{ background: "#161b27", border: "1px solid #2a3245", borderRadius: 8, padding: "12px 16px", minWidth: 220, flex: "0 0 auto" }}>
              <div style={{ fontSize: 11, fontFamily: "monospace", color: "#a78bfa", marginBottom: 2 }}>{a.asin}</div>
              {a.title && <div style={{ fontSize: 11, color: "#e2e8f0", marginBottom: 2, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</div>}
              {a.brand && <div style={{ fontSize: 10, color: "#8892a4", marginBottom: 6 }}>{a.brand}</div>}
              <div style={{ display: "flex", gap: 10, fontSize: 11, flexWrap: "wrap" }}>
                <div><div style={{ color: "#555f6e" }}>Views</div><div style={{ color: "#e2e8f0", fontWeight: 600 }}>{fmt(a.impressions, "compact")}</div></div>
                <div><div style={{ color: "#555f6e" }}>CVR</div><div style={{ color: cvr > 0.5 ? "#22c55e" : "#f59e0b", fontWeight: 600 }}>{cvr.toFixed(2)}%</div></div>
                <div><div style={{ color: "#555f6e" }}>ATC%</div><div style={{ color: "#e2e8f0", fontWeight: 600 }}>{atcPct.toFixed(1)}%</div></div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Main table */}
      <div style={{ background: "#161b27", border: "1px solid #2a3245", borderRadius: 10, overflow: "hidden" }}>
        <div style={{ padding: "10px 16px", borderBottom: "1px solid #2a3245", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "#8892a4" }}>
            <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{filtered.length.toLocaleString()}</span> ASINs
            {brandFilter !== "ALL" && <span style={{ color: "#6366f1", marginLeft: 6 }}>{brandFilter}</span>}
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle} onClick={() => onSort("asin")}>ASIN<SortArrow col="asin" sortCol={sortCol} sortDir={sortDir} /></th>
                <th style={thStyle} onClick={() => onSort("productTitle")}>Product<SortArrow col="productTitle" sortCol={sortCol} sortDir={sortDir} /></th>
                <th style={thStyle} onClick={() => onSort("brandName")}>Brand<SortArrow col="brandName" sortCol={sortCol} sortDir={sortDir} /></th>
                <th style={numTh} onClick={() => onSort("impressions")}>Page Views<SortArrow col="impressions" sortCol={sortCol} sortDir={sortDir} /></th>
                <th style={numTh} onClick={() => onSort("clicks")}>Clicks<SortArrow col="clicks" sortCol={sortCol} sortDir={sortDir} /></th>
                <th style={numTh} onClick={() => onSort("addToCarts")}>ATC<SortArrow col="addToCarts" sortCol={sortCol} sortDir={sortDir} /></th>
                <th style={numTh}>ATC %</th>
                <th style={numTh} onClick={() => onSort("purchases")}>Purchases<SortArrow col="purchases" sortCol={sortCol} sortDir={sortDir} /></th>
                <th style={numTh}>CVR</th>
                <th style={numTh}>%P (P/ATC)</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => {
                const cvr = row.impressions > 0 ? (row.purchases / row.impressions * 100) : 0;
                const atcPct = row.impressions > 0 ? (row.addToCarts / row.impressions * 100) : 0;
                const pPct = row.addToCarts > 0 ? (row.purchases / row.addToCarts * 100) : 0;
                return (
                  <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "rgba(28,35,51,0.3)" }}>
                    <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: 11, color: "#a78bfa" }}>{row.asin}</td>
                    <td style={{ ...tdStyle, maxWidth: 240 }}>
                      <span style={{ display: "inline-block", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {row.productTitle || <span style={{ color: "#555f6e" }}>--</span>}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, fontSize: 11 }}>
                      {row.brandName ? (
                        <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 500, background: "rgba(99,102,241,0.1)", color: "#a78bfa" }}>{row.brandName}</span>
                      ) : <span style={{ color: "#555f6e" }}>--</span>}
                    </td>
                    {(() => {
                      const prev = prevMap.get(row.asin);
                      return (<>
                        <td style={numTd}>
                          <MetricBar value={row.impressions} max={maxes.impressions} color="#6366f1" label={fmt(row.impressions, "compact")} />
                          {prev && <DeltaBadge current={row.impressions} previous={prev.impressions} />}
                        </td>
                        <td style={numTd}>
                          <MetricBar value={row.clicks} max={maxes.clicks} color="#8b5cf6" label={fmt(row.clicks, "number")} />
                          {prev && <DeltaBadge current={row.clicks} previous={prev.clicks} />}
                        </td>
                        <td style={numTd}>
                          <MetricBar value={row.addToCarts} max={maxes.addToCarts} color="#a78bfa" label={fmt(row.addToCarts, "number")} />
                          {prev && <DeltaBadge current={row.addToCarts} previous={prev.addToCarts} />}
                        </td>
                        <td style={numTd}><span style={{ color: atcPct > 5 ? "#22c55e" : atcPct > 2 ? "#f59e0b" : "#555f6e" }}>{atcPct.toFixed(1)}%</span></td>
                        <td style={numTd}>
                          <MetricBar value={row.purchases} max={maxes.purchases} color="#22c55e" label={String(row.purchases)} />
                          {prev && <DeltaBadge current={row.purchases} previous={prev.purchases} />}
                        </td>
                        <td style={numTd}><span style={{ color: cvr > 0.5 ? "#22c55e" : cvr > 0.2 ? "#f59e0b" : "#555f6e" }}>{cvr.toFixed(2)}%</span></td>
                        <td style={numTd}><span style={{ color: pPct > 40 ? "#22c55e" : pPct > 20 ? "#f59e0b" : "#555f6e" }}>{pPct.toFixed(1)}%</span></td>
                      </>);
                    })()}
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={10} style={{ ...tdStyle, textAlign: "center", color: "#555f6e", padding: 32 }}>No catalog data found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
