"use client";
import { useState, useEffect, useCallback } from "react";
import TopNav from "@/components/shared/TopNav";
import DateRangePicker from "@/components/shared/DateRangePicker";
import KpiCard from "@/components/shared/KpiCard";
import { KpiCardSkeleton, ChartSkeleton } from "@/components/shared/Skeleton";
import SpendRevenueChart from "@/components/master-overview/SpendRevenueChart";
import { fetchSales, type SalesData } from "@/lib/api-client";
import type { TimeSeriesPoint } from "@/lib/types";
import { useAccount } from "@/lib/account-context";

export default function MasterOverviewPage() {
  const [dateRange, setDateRange] = useState("Last 30D");
  const [compare, setCompare]     = useState("prev-period");

  const [salesData, setSalesData]           = useState<SalesData | null>(null);
  const [salesLoading, setSalesLoading]     = useState(true);
  const [error, setError]                   = useState<string | null>(null);

  const { activeAccount } = useAccount();
  const accountId = activeAccount?.id ?? "";

  const load = useCallback(async () => {
    setSalesLoading(true);
    setError(null);
    fetchSales({ accountId: accountId || undefined, dateRange })
      .then((result) => { setSalesData(result); setSalesLoading(false); })
      .catch((e) => { setError(String(e)); setSalesLoading(false); });
  }, [accountId, dateRange]);

  useEffect(() => { load(); }, [load]);

  // SP-API derived KPIs
  const scRevenue  = salesData?.summary.totalRevenue ?? 0;
  const scOrders   = salesData?.summary.totalOrders  ?? 0;
  const scUnits    = salesData?.summary.totalUnits   ?? 0;
  const avgOrderValue = scOrders > 0 ? Math.round((scRevenue / scOrders) * 100) / 100 : 0;

  // Build chart time series from real SP-API daily data (empty until loaded)
  const timeSeries: TimeSeriesPoint[] = salesData?._source === "live"
    ? salesData.dailySeries.map((d) => ({ date: d.date, revenue: d.totalRevenue, spend: 0, acos: 0 }))
    : [];

  return (
    <div style={{ minHeight: "100vh", background: "#0d1117" }}>
      <TopNav />

      <main style={{ padding: "24px 28px", maxWidth: 1600, margin: "0 auto" }}>

        {/* Page header */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
          flexWrap: "wrap",
          gap: 12,
        }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: "#e2e8f0", letterSpacing: "-0.4px" }}>
              Master Overview
            </h1>
            <p style={{ fontSize: 12, color: "#8892a4", marginTop: 2 }}>
              Seller Central — Amazon.in (Mosaic Wellness)
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {/* Campaign type filter */}
            <DateRangePicker
              value={dateRange}
              onChange={(v) => setDateRange(v)}
              compareValue={compare}
              onCompareChange={setCompare}
              showCompare
            />

            {/* Refresh button */}
            <button
              onClick={load}
              disabled={salesLoading}
              style={{
                padding: "6px 12px", borderRadius: 6,
                background: "#1c2333", border: "1px solid #2a3245",
                color: salesLoading ? "#555f6e" : "#8892a4",
                cursor: salesLoading ? "default" : "pointer", fontSize: 12,
                display: "flex", alignItems: "center", gap: 5,
              }}
            >
              <span style={{ display: "inline-block", animation: salesLoading ? "spin 1s linear infinite" : "none" }}>
                ↻
              </span>
              {salesLoading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>

        {/* Error state */}
        {error && (
          <div style={{
            background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)",
            borderRadius: 8, padding: "12px 16px", marginBottom: 20,
            fontSize: 13, color: "#ef4444",
          }}>
            ⚠ Error loading data: {error}
            <button onClick={load} style={{
              marginLeft: 12, color: "#6366f1", background: "transparent",
              border: "none", cursor: "pointer", fontSize: 12,
            }}>Retry</button>
          </div>
        )}

        {/* Primary KPI row — Seller Central data */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
          {salesLoading ? (
            Array.from({ length: 4 }).map((_, i) => <KpiCardSkeleton key={i} />)
          ) : (
            <>
              <KpiCard label="Total Revenue"   metric={{ value: scRevenue,      delta: 0, positive: true }} format="currency"   icon={<RevenueIcon />} />
              <KpiCard label="Orders"          metric={{ value: scOrders,       delta: 0, positive: true }} format="number"     icon={<OrdersIcon />} />
              <KpiCard label="Units Sold"      metric={{ value: scUnits,        delta: 0, positive: true }} format="number"     icon={<UnitsIcon />} />
              <KpiCard label="Avg Order Value" metric={{ value: avgOrderValue,  delta: 0, positive: true }} format="currency"   icon={<AovIcon />} />
            </>
          )}
        </div>

        {/* Revenue trend chart */}
        <div style={{ marginBottom: 16 }}>
          {salesLoading ? <ChartSkeleton /> : <SpendRevenueChart data={timeSeries} />}
        </div>
      </main>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

const RevenueIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" />
  </svg>
);
const OrdersIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 01-8 0" />
  </svg>
);
const UnitsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="1" y="3" width="15" height="13" /><path d="M16 8h4l3 3v5h-7V8z" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
  </svg>
);
const AovIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
  </svg>
);
