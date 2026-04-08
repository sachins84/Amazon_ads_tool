"use client";
import { useState, useEffect, useCallback } from "react";
import TopNav from "@/components/shared/TopNav";
import DateRangePicker from "@/components/shared/DateRangePicker";
import KpiCard from "@/components/shared/KpiCard";
import MockBanner from "@/components/shared/MockBanner";
import { KpiCardSkeleton, ChartSkeleton, TableRowSkeleton } from "@/components/shared/Skeleton";
import SpendRevenueChart from "@/components/master-overview/SpendRevenueChart";
import AcosTrendChart from "@/components/master-overview/AcosTrendChart";
import SpendByTypeDonut from "@/components/master-overview/SpendByTypeDonut";
import TopCampaignsChart from "@/components/master-overview/TopCampaignsChart";
import CampaignTable from "@/components/master-overview/CampaignTable";
import { fetchOverview, fetchSales, type OverviewData, type SalesData } from "@/lib/api-client";
import { generateTimeSeries } from "@/lib/mock-data";
import type { TimeSeriesPoint } from "@/lib/types";
import { useAccount } from "@/lib/account-context";

export default function MasterOverviewPage() {
  const [dateRange, setDateRange]     = useState("Last 30D");
  const [compare, setCompare]         = useState("prev-period");
  const [campaignType, setCampaignType] = useState<"ALL" | "SP" | "SB" | "SD">("ALL");

  const [data, setData]         = useState<OverviewData | null>(null);
  const [salesData, setSalesData] = useState<SalesData | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  const { activeAccount } = useAccount();
  const accountId = activeAccount?.id ?? "";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch ads data + seller central data in parallel
      const [adsResult, salesResult] = await Promise.all([
        fetchOverview({ accountId: accountId || undefined, dateRange, campaignType }),
        fetchSales({ accountId: accountId || undefined, dateRange }),
      ]);
      setData(adsResult);
      setSalesData(salesResult);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [accountId, dateRange, campaignType]);

  useEffect(() => { load(); }, [load]);

  const isMock = data?._source === "mock";

  // Compute live TACoS when SP-API data is available
  const tacos = (salesData && data && salesData.summary.totalRevenue > 0)
    ? Math.round((data.kpis.spend.value / salesData.summary.totalRevenue) * 1000) / 10
    : data?.kpis.tacos.value ?? 0;

  const totalRevenue = salesData?.summary.totalRevenue ?? data?.kpis.revenue.value ?? 0;
  const totalOrders  = salesData?.summary.totalOrders  ?? data?.kpis.orders.value  ?? 0;
  const spApiLive    = salesData?._source === "live";

  // Build chart time series from real SP-API daily data, fall back to mock
  const timeSeries: TimeSeriesPoint[] = (() => {
    if (salesData?._source === "live" && salesData.dailySeries.length > 0) {
      const totalSpend   = data?.kpis.spend.value ?? 0;
      const totalScRev   = salesData.summary.totalRevenue;
      const spendRatio   = totalScRev > 0 ? totalSpend / totalScRev : 0;
      return salesData.dailySeries.map((d) => {
        const revenue = d.totalRevenue;
        const spend   = Math.round(revenue * spendRatio * 100) / 100;
        const acos    = revenue > 0 ? Math.round((spend / revenue) * 1000) / 10 : 0;
        return { date: d.date, revenue, spend, acos };
      });
    }
    return generateTimeSeries(30);
  })();

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
              Account-wide advertising performance
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {/* Campaign type filter */}
            <div style={{ display: "flex", gap: 4 }}>
              {(["ALL", "SP", "SB", "SD"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setCampaignType(t)}
                  style={{
                    padding: "5px 12px", borderRadius: 6, fontSize: 12, fontWeight: 500,
                    cursor: "pointer", border: "1px solid",
                    borderColor: campaignType === t ? "#6366f1" : "#2a3245",
                    background: campaignType === t ? "#6366f120" : "#1c2333",
                    color: campaignType === t ? "#6366f1" : "#8892a4",
                    transition: "all 0.15s",
                  }}
                >
                  {t === "ALL" ? "All Types" : t}
                </button>
              ))}
            </div>

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
              disabled={loading}
              style={{
                padding: "6px 12px", borderRadius: 6,
                background: "#1c2333", border: "1px solid #2a3245",
                color: loading ? "#555f6e" : "#8892a4",
                cursor: loading ? "default" : "pointer", fontSize: 12,
                display: "flex", alignItems: "center", gap: 5,
              }}
            >
              <span style={{ display: "inline-block", animation: loading ? "spin 1s linear infinite" : "none" }}>
                ↻
              </span>
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>

        {/* Mock banner */}
        {isMock && <MockBanner />}

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

        {/* Primary KPI row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 12 }}>
          {loading || !data ? (
            Array.from({ length: 5 }).map((_, i) => <KpiCardSkeleton key={i} />)
          ) : (
            <>
              <KpiCard label="Total Spend"    metric={data.kpis.spend}       format="currency"   icon={<SpendIcon />} />
              <KpiCard label="Total Revenue"  metric={data.kpis.revenue}     format="currency"   icon={<RevenueIcon />} />
              <KpiCard label="ACOS"           metric={data.kpis.acos}        format="percent"    icon={<AcosIcon />} />
              <KpiCard label="ROAS"           metric={data.kpis.roas}        format="multiplier" icon={<RoasIcon />} />
              <KpiCard label="Orders"         metric={data.kpis.orders}      format="number"     icon={<OrdersIcon />} />
            </>
          )}
        </div>

        {/* Secondary KPI row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12, marginBottom: 24 }}>
          {loading || !data ? (
            Array.from({ length: 6 }).map((_, i) => <KpiCardSkeleton key={i} />)
          ) : (
            <>
              <KpiCard label="Impressions"  metric={data.kpis.impressions}                                        format="compact"  small />
              <KpiCard label="Clicks"       metric={data.kpis.clicks}                                            format="compact"  small />
              <KpiCard label="CTR"          metric={data.kpis.ctr}                                               format="percent"  small />
              <KpiCard label="CPC"          metric={data.kpis.cpc}                                               format="currency" small />
              <KpiCard label="Total Revenue"metric={{ value: totalRevenue, delta: 0, positive: true }}           format="currency" small />
              <KpiCard
                label={spApiLive ? "TACoS" : "TACoS (est.)"}
                metric={{ value: tacos, delta: 0, positive: true }}
                format="percent"
                small
              />
            </>
          )}
        </div>

        {/* Charts */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
          {loading ? (
            <><ChartSkeleton /><ChartSkeleton /></>
          ) : (
            <>
              <SpendRevenueChart data={timeSeries} />
              <AcosTrendChart data={timeSeries} targetAcos={20} />
            </>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: 16, marginBottom: 24 }}>
          {loading || !data ? (
            <><ChartSkeleton height={240} /><ChartSkeleton height={240} /></>
          ) : (
            <>
              <SpendByTypeDonut data={data.spendByType} />
              <TopCampaignsChart campaigns={data.campaigns} />
            </>
          )}
        </div>

        {/* Campaign table */}
        {loading ? (
          <div style={{ background: "#161b27", border: "1px solid #2a3245", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #2a3245" }}>
              <div style={{ height: 13, width: 160, background: "#1c2333", borderRadius: 4 }} />
            </div>
            <table style={{ width: "100%" }}>
              <tbody>
                {Array.from({ length: 8 }).map((_, i) => <TableRowSkeleton key={i} cols={13} />)}
              </tbody>
            </table>
          </div>
        ) : data ? (
          <CampaignTable campaigns={data.campaigns} />
        ) : null}
      </main>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

const SpendIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
  </svg>
);
const RevenueIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" />
  </svg>
);
const AcosIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" /><path d="M12 8v8M8 12h8" />
  </svg>
);
const RoasIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
  </svg>
);
const OrdersIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 01-8 0" />
  </svg>
);
