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
  { key: "sqp",          label: "Search Query Performance", desc: "Brand-level keyword market share" },
  { key: "catalog",      label: "Catalog Performance", desc: "ASIN x keyword performance" },
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchBrandAnalytics({
        accountId: accountId || undefined,
        dateRange,
        onLiveData: (liveData) => {
          // Upgrade from mock to live if real data arrives
          setData(liveData);
          setIsMock(false);
        },
      });
      setData(result);
      setIsMock(result._source === "mock");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [accountId, dateRange]);

  useEffect(() => { load(); }, [load]);

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
              onClick={load}
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
            <button onClick={load} style={{ marginLeft: 12, color: "#6366f1", background: "transparent", border: "none", cursor: "pointer", fontSize: 12 }}>
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
              <SQPTable
                rows={data.sqp}
                search={search}
                sortCol={sortCol}
                sortDir={sortDir}
                onSort={(col) => {
                  if (sortCol === col) setSortDir((d) => d === "asc" ? "desc" : "asc");
                  else { setSortCol(col); setSortDir("asc"); }
                }}
              />
            )}
            {subTab === "catalog" && data && (
              <CatalogTable
                rows={data.catalogPerformance}
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

// ─── SQP Table ───────────────────────────────────────────────────────────────

function SQPTable({
  rows, search, sortCol, sortDir, onSort,
}: {
  rows: SQPRow[];
  search: string;
  sortCol: string;
  sortDir: "asc" | "desc";
  onSort: (col: string) => void;
}) {
  const filtered = useMemo(() => {
    let r = rows;
    if (search) {
      const q = search.toLowerCase();
      r = r.filter((row) => row.searchQuery.toLowerCase().includes(q));
    }
    return sortRows(r, sortCol, sortDir);
  }, [rows, search, sortCol, sortDir]);

  return (
    <div style={{ background: "#161b27", border: "1px solid #2a3245", borderRadius: 10, overflow: "hidden" }}>
      <div style={{ padding: "10px 16px", borderBottom: "1px solid #2a3245", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "#8892a4" }}>
          <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{filtered.length.toLocaleString()}</span> search queries
        </span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle} onClick={() => onSort("searchQuery")}>Search Query<SortArrow col="searchQuery" sortCol={sortCol} sortDir={sortDir} /></th>
              <th style={numTh} onClick={() => onSort("totalSearchVolume")}>Search Volume<SortArrow col="totalSearchVolume" sortCol={sortCol} sortDir={sortDir} /></th>
              <th style={numTh} onClick={() => onSort("impressions")}>Impressions<SortArrow col="impressions" sortCol={sortCol} sortDir={sortDir} /></th>
              <th style={numTh} onClick={() => onSort("clicks")}>Clicks<SortArrow col="clicks" sortCol={sortCol} sortDir={sortDir} /></th>
              <th style={numTh} onClick={() => onSort("purchases")}>Purchases<SortArrow col="purchases" sortCol={sortCol} sortDir={sortDir} /></th>
              <th style={numTh} onClick={() => onSort("impressionShare")}>Impr. Share<SortArrow col="impressionShare" sortCol={sortCol} sortDir={sortDir} /></th>
              <th style={numTh} onClick={() => onSort("clickShare")}>Click Share<SortArrow col="clickShare" sortCol={sortCol} sortDir={sortDir} /></th>
              <th style={numTh} onClick={() => onSort("purchaseShare")}>Purchase Share<SortArrow col="purchaseShare" sortCol={sortCol} sortDir={sortDir} /></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "rgba(28,35,51,0.3)" }}>
                <td style={{ ...tdStyle, fontWeight: 500, maxWidth: 280 }}>
                  <span style={{ display: "inline-block", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }}>{row.searchQuery}</span>
                </td>
                <td style={numTd}>{fmt(row.totalSearchVolume, "compact")}</td>
                <td style={numTd}>{fmt(row.impressions, "compact")}</td>
                <td style={numTd}>{fmt(row.clicks, "compact")}</td>
                <td style={numTd}>{fmt(row.purchases, "number")}</td>
                <td style={numTd}><ShareBar value={row.impressionShare} color="#6366f1" /></td>
                <td style={numTd}><ShareBar value={row.clickShare} color="#8b5cf6" /></td>
                <td style={numTd}><ShareBar value={row.purchaseShare} color="#22c55e" /></td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={8} style={{ ...tdStyle, textAlign: "center", color: "#555f6e", padding: 32 }}>No search queries found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Catalog Performance Table ───────────────────────────────────────────────

function CatalogTable({
  rows, search, sortCol, sortDir, onSort,
}: {
  rows: CatalogPerformanceRow[];
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
        row.asin.toLowerCase().includes(q) ||
        row.productTitle.toLowerCase().includes(q) ||
        row.searchQuery.toLowerCase().includes(q)
      );
    }
    return sortRows(r, sortCol, sortDir);
  }, [rows, search, sortCol, sortDir]);

  // Compute per-ASIN aggregated stats for the summary cards
  const asinSummary = useMemo(() => {
    const map = new Map<string, { asin: string; title: string; impressions: number; clicks: number; purchases: number; queries: number }>();
    for (const row of rows) {
      const existing = map.get(row.asin);
      if (existing) {
        existing.impressions += row.impressions;
        existing.clicks += row.clicks;
        existing.purchases += row.purchases;
        existing.queries += 1;
      } else {
        map.set(row.asin, {
          asin: row.asin,
          title: row.productTitle,
          impressions: row.impressions,
          clicks: row.clicks,
          purchases: row.purchases,
          queries: 1,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.impressions - a.impressions).slice(0, 5);
  }, [rows]);

  return (
    <>
      {/* Top ASINs summary */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, overflowX: "auto", paddingBottom: 4 }}>
        {asinSummary.map((a) => (
          <div key={a.asin} style={{
            background: "#161b27", border: "1px solid #2a3245", borderRadius: 8,
            padding: "12px 16px", minWidth: 200, flex: "0 0 auto",
          }}>
            <div style={{ fontSize: 11, fontFamily: "monospace", color: "#a78bfa", marginBottom: 4 }}>{a.asin}</div>
            <div style={{ fontSize: 11, color: "#8892a4", marginBottom: 8, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {a.title}
            </div>
            <div style={{ display: "flex", gap: 12, fontSize: 11 }}>
              <div>
                <div style={{ color: "#555f6e" }}>Impr</div>
                <div style={{ color: "#e2e8f0", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{fmt(a.impressions, "compact")}</div>
              </div>
              <div>
                <div style={{ color: "#555f6e" }}>Clicks</div>
                <div style={{ color: "#e2e8f0", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{fmt(a.clicks, "compact")}</div>
              </div>
              <div>
                <div style={{ color: "#555f6e" }}>Purchases</div>
                <div style={{ color: "#e2e8f0", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{a.purchases}</div>
              </div>
              <div>
                <div style={{ color: "#555f6e" }}>Queries</div>
                <div style={{ color: "#e2e8f0", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{a.queries}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ background: "#161b27", border: "1px solid #2a3245", borderRadius: 10, overflow: "hidden" }}>
        <div style={{ padding: "10px 16px", borderBottom: "1px solid #2a3245", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "#8892a4" }}>
            <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{filtered.length.toLocaleString()}</span> ASIN x keyword rows
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle} onClick={() => onSort("asin")}>ASIN<SortArrow col="asin" sortCol={sortCol} sortDir={sortDir} /></th>
                <th style={thStyle} onClick={() => onSort("productTitle")}>Product Title<SortArrow col="productTitle" sortCol={sortCol} sortDir={sortDir} /></th>
                <th style={thStyle} onClick={() => onSort("searchQuery")}>Search Query<SortArrow col="searchQuery" sortCol={sortCol} sortDir={sortDir} /></th>
                <th style={numTh} onClick={() => onSort("impressions")}>Impressions<SortArrow col="impressions" sortCol={sortCol} sortDir={sortDir} /></th>
                <th style={numTh} onClick={() => onSort("clicks")}>Clicks<SortArrow col="clicks" sortCol={sortCol} sortDir={sortDir} /></th>
                <th style={numTh} onClick={() => onSort("addToCarts")}>Add to Cart<SortArrow col="addToCarts" sortCol={sortCol} sortDir={sortDir} /></th>
                <th style={numTh} onClick={() => onSort("purchases")}>Purchases<SortArrow col="purchases" sortCol={sortCol} sortDir={sortDir} /></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => {
                const ctr = row.impressions > 0 ? (row.clicks / row.impressions * 100) : 0;
                const cvr = row.clicks > 0 ? (row.purchases / row.clicks * 100) : 0;
                return (
                  <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "rgba(28,35,51,0.3)" }}>
                    <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: 11, color: "#a78bfa" }}>{row.asin}</td>
                    <td style={{ ...tdStyle, maxWidth: 220 }}>
                      <span style={{ display: "inline-block", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>{row.productTitle}</span>
                    </td>
                    <td style={{ ...tdStyle, fontWeight: 500, maxWidth: 220 }}>
                      <span style={{ display: "inline-block", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>{row.searchQuery}</span>
                    </td>
                    <td style={numTd}>{fmt(row.impressions, "compact")}</td>
                    <td style={numTd}>
                      {fmt(row.clicks, "number")}
                      <span style={{ fontSize: 10, color: "#555f6e", marginLeft: 4 }}>{ctr.toFixed(1)}%</span>
                    </td>
                    <td style={numTd}>{fmt(row.addToCarts, "number")}</td>
                    <td style={numTd}>
                      {row.purchases}
                      <span style={{ fontSize: 10, color: cvr > 5 ? "#22c55e" : "#555f6e", marginLeft: 4 }}>{cvr.toFixed(1)}%</span>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={7} style={{ ...tdStyle, textAlign: "center", color: "#555f6e", padding: 32 }}>No catalog data found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
