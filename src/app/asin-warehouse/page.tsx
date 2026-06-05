"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import TopNav from "@/components/shared/TopNav";
import { useAccount } from "@/lib/account-context";
import { fmt } from "@/lib/utils";

const RANGES = ["Yesterday", "Last 7D", "Last 14D"] as const;
type Range = typeof RANGES[number];

interface AsinWarehouseRow {
  asin: string;
  asinTitle: string | null;
  shipCity: string;
  shipState: string;
  orders: number;
  units: number;
  sales: number;
}
interface Resp {
  brandName?: string;
  marketplace?: string;
  currency?: string;
  dateRange?: { startDate: string; endDate: string };
  rows?: AsinWarehouseRow[];
  totals?: { orders: number; units: number; sales: number; asins: number; warehouses: number };
  freshness?: { lastRefreshAt: string | null; error: string | null; coverageMin: string | null; coverageMax: string | null; stale: boolean };
  code?: string;
  message?: string;
}

type GroupBy = "asin-warehouse" | "asin" | "warehouse";

export default function AsinWarehousePage() {
  const { activeAccount } = useAccount();
  const accountId = activeAccount?.id ?? "";
  const [range, setRange] = useState<Range>("Yesterday");
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("asin-warehouse");

  const load = useCallback(async () => {
    if (!accountId) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/asin-warehouse?accountId=${accountId}&dateRange=${encodeURIComponent(range)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json() as Resp;
      setData(j);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [accountId, range]);

  useEffect(() => { load(); }, [load]);

  const currency = data?.currency ?? (activeAccount?.adsMarketplace === "IN" ? "INR" : "USD");

  // Group rows per the user-selected grouping. The API always returns
  // asin × warehouse; collapse client-side for the other two modes so
  // operators can switch view without another network round-trip.
  const grouped = useMemo(() => {
    const rows = data?.rows ?? [];
    if (groupBy === "asin-warehouse") return rows;
    const map = new Map<string, AsinWarehouseRow>();
    for (const r of rows) {
      const key = groupBy === "asin" ? r.asin : `${r.shipCity}|${r.shipState}`;
      const cur = map.get(key) ?? {
        asin: groupBy === "asin" ? r.asin : "",
        asinTitle: groupBy === "asin" ? r.asinTitle : null,
        shipCity:  groupBy === "warehouse" ? r.shipCity  : "",
        shipState: groupBy === "warehouse" ? r.shipState : "",
        orders: 0, units: 0, sales: 0,
      };
      cur.orders += r.orders;
      cur.units  += r.units;
      cur.sales  += r.sales;
      if (groupBy === "asin" && !cur.asinTitle && r.asinTitle) cur.asinTitle = r.asinTitle;
      map.set(key, cur);
    }
    return [...map.values()].sort((a, b) => b.sales - a.sales);
  }, [data, groupBy]);

  const filtered = useMemo(() => {
    if (!search) return grouped;
    const q = search.toLowerCase();
    return grouped.filter((r) =>
      r.asin.toLowerCase().includes(q) ||
      (r.asinTitle ?? "").toLowerCase().includes(q) ||
      r.shipCity.toLowerCase().includes(q) ||
      r.shipState.toLowerCase().includes(q)
    );
  }, [grouped, search]);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-base)" }}>
      <TopNav />
      <main style={{ padding: "24px 28px", maxWidth: 1600, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>ASIN × Warehouse</h1>
            <p style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
              {data?.brandName ?? activeAccount?.name ?? "—"}
              {data?.totals ? ` · ${data.totals.asins} ASINs across ${data.totals.warehouses} warehouses` : ""}
              {data?.freshness?.lastRefreshAt && ` · refreshed ${humanTime(data.freshness.lastRefreshAt)}`}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ display: "flex", gap: 4 }}>
              {RANGES.map((r) => (
                <button key={r} onClick={() => setRange(r)} style={pillBtn(range === r)}>{r}</button>
              ))}
            </div>
            <button onClick={load} disabled={loading} style={refreshBtn(loading)}>
              {loading ? "Loading…" : "↻ Reload"}
            </button>
          </div>
        </div>

        {!accountId && (
          <Card>Pick a brand from the top-right dropdown.</Card>
        )}

        {accountId && data?.code === "CONFIG_MISSING" && (
          <Card warning>
            <strong>SP-API not configured for {data.brandName ?? "this brand"}.</strong>
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-secondary)" }}>
              {data.message ?? "Set spMarketplaceId on the /accounts page to enable Seller-Central order data for this brand."}
            </div>
          </Card>
        )}

        {error && (
          <Card warning>
            ⚠ {error}
            <button onClick={load} style={{ marginLeft: 12, color: "var(--c-indigo-text)", background: "transparent", border: "none", cursor: "pointer" }}>Retry</button>
          </Card>
        )}

        {accountId && data && !data.code && (
          <>
            {/* KPI strip */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 16 }}>
              <KpiTile label="Orders" value={fmt(data.totals?.orders ?? 0, "number", currency)} />
              <KpiTile label="Units"  value={fmt(data.totals?.units  ?? 0, "number", currency)} />
              <KpiTile label="Sales"  value={fmt(data.totals?.sales  ?? 0, "currency", currency)} />
            </div>

            {/* Controls */}
            <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search ASIN, title, city, state…"
                style={inputStyle}
              />
              <div style={{ display: "flex", gap: 4 }}>
                <button onClick={() => setGroupBy("asin-warehouse")} style={pillBtn(groupBy === "asin-warehouse")}>ASIN × Warehouse</button>
                <button onClick={() => setGroupBy("asin")}           style={pillBtn(groupBy === "asin")}>By ASIN</button>
                <button onClick={() => setGroupBy("warehouse")}      style={pillBtn(groupBy === "warehouse")}>By Warehouse</button>
              </div>
              <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>{filtered.length} rows</span>
            </div>

            {/* Table */}
            <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                      {groupBy !== "warehouse" && <Th align="left">ASIN</Th>}
                      {groupBy !== "warehouse" && <Th align="left">Title</Th>}
                      {groupBy !== "asin" && <Th align="left">City</Th>}
                      {groupBy !== "asin" && <Th align="left">State</Th>}
                      <Th align="right">Orders</Th>
                      <Th align="right">Units</Th>
                      <Th align="right">Sales</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r, i) => (
                      <tr key={`${r.asin}|${r.shipCity}|${r.shipState}|${i}`} style={{ borderBottom: "1px solid var(--bg-input)" }}>
                        {groupBy !== "warehouse" && <Td style={{ color: "var(--c-indigo-text)", fontFamily: "monospace" }}>{r.asin}</Td>}
                        {groupBy !== "warehouse" && <Td title={r.asinTitle ?? ""} style={{ color: "var(--text-primary)", maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.asinTitle ?? "—"}</Td>}
                        {groupBy !== "asin" && <Td style={{ color: "var(--text-primary)" }}>{r.shipCity || "—"}</Td>}
                        {groupBy !== "asin" && <Td style={{ color: "var(--text-secondary)" }}>{r.shipState || "—"}</Td>}
                        <Td align="right" style={{ color: "var(--text-primary)" }}>{r.orders}</Td>
                        <Td align="right" style={{ color: "var(--text-primary)" }}>{r.units}</Td>
                        <Td align="right" style={{ color: "var(--text-primary)" }}>{fmt(r.sales, "currency", currency)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filtered.length === 0 && !loading && (
                  <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
                    No orders in this window.
                    {data.freshness?.stale && " The SP-API All Orders refresh may not have run yet — check /api/admin/refresh."}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function KpiTile({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px" }}>
      <div style={{ fontSize: 10, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)", marginTop: 4 }}>{value}</div>
    </div>
  );
}

function Card({ children, warning }: { children: React.ReactNode; warning?: boolean }) {
  return (
    <div style={{
      background: warning ? "var(--c-warning-banner-bg)" : "var(--bg-card)",
      border: `1px solid ${warning ? "var(--c-warning-banner-bd)" : "var(--border)"}`,
      color: warning ? "var(--c-warning-text)" : "var(--text-secondary)",
      borderRadius: 10, padding: 16, fontSize: 13,
    }}>
      {children}
    </div>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <th style={{ textAlign: align, padding: "8px 10px", fontWeight: 500, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>{children}</th>;
}
function Td({ children, align = "left", style, title }: { children: React.ReactNode; align?: "left" | "right"; style?: React.CSSProperties; title?: string }) {
  return <td style={{ textAlign: align, padding: "8px 10px", ...style }} title={title}>{children}</td>;
}

function humanTime(iso: string): string {
  try {
    const d = new Date(iso);
    const mins = Math.round((Date.now() - d.getTime()) / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} min ago`;
    if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
    return d.toLocaleString();
  } catch { return iso; }
}

const inputStyle: React.CSSProperties = {
  background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 6,
  color: "var(--text-primary)", padding: "6px 10px", fontSize: 12, outline: "none", width: 280,
};
function pillBtn(on: boolean): React.CSSProperties {
  return {
    padding: "5px 10px", borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: "pointer",
    border: "1px solid",
    borderColor: on ? "var(--c-indigo-text)" : "var(--border)",
    background:  on ? "var(--c-indigo-bg)"   : "transparent",
    color:       on ? "var(--c-indigo-text)" : "var(--text-secondary)",
  };
}
function refreshBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: "6px 12px", borderRadius: 6, background: "var(--bg-input)",
    border: "1px solid var(--border)", color: disabled ? "var(--text-muted)" : "var(--text-secondary)",
    cursor: disabled ? "default" : "pointer", fontSize: 12,
  };
}
