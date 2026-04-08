"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import TopNav from "@/components/shared/TopNav";
import MockBanner from "@/components/shared/MockBanner";
import { TableRowSkeleton } from "@/components/shared/Skeleton";
import TargetingFiltersBar from "@/components/targeting-360/TargetingFilters";
import TargetingTable from "@/components/targeting-360/TargetingTable";
import TargetDetailDrawer from "@/components/targeting-360/TargetDetailDrawer";
import ChangeBidModal from "@/components/targeting-360/ChangeBidModal";
import type { Target, TargetingFilters } from "@/lib/types";
import {
  fetchTargeting,
  updateTargetBid,
  updateTargetStatus,
  bulkUpdateTargets,
  type TargetingData,
} from "@/lib/api-client";
import { mockCampaigns } from "@/lib/mock-data";
import { useAccount } from "@/lib/account-context";

const DEFAULT_FILTERS: TargetingFilters = {
  search: "", campaignIds: [], adGroupIds: [],
  targetType: "ALL", matchType: "ALL", status: "ALL",
  bidMin: "", bidMax: "", acosMin: "", acosMax: "", spendMin: "",
};

const campaignList = mockCampaigns.map((c) => ({ id: c.id, name: c.name }));

export default function Targeting360Page() {
  const [filters, setFilters]   = useState<TargetingFilters>(DEFAULT_FILTERS);
  const [dateRange, setDateRange] = useState("Last 30D");

  // API state
  const [apiData, setApiData]   = useState<TargetingData | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [isMock, setIsMock]     = useState(false);

  // Local mutations on top of fetched data
  const [localTargets, setLocalTargets] = useState<Target[]>([]);

  // UI state
  const [selectedIds, setSelectedIds]   = useState<Set<string>>(new Set());
  const [activeTarget, setActiveTarget] = useState<Target | null>(null);
  const [showBidModal, setShowBidModal] = useState(false);
  const [toast, setToast]               = useState<{ msg: string; type?: "success" | "error" } | null>(null);
  const [saving, setSaving]             = useState(false);

  // Active account from context (or fall back to env-var mode)
  const { activeAccount } = useAccount();
  const accountId = activeAccount?.id ?? "";
  const profileId = activeAccount?.adsProfileId ?? (process.env.NEXT_PUBLIC_AMAZON_PROFILE_ID ?? "");

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Load from API
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchTargeting({ accountId: accountId || undefined, profileId, dateRange });
      setApiData(result);
      setLocalTargets(result.targets);
      setIsMock(result._source === "mock");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [accountId, profileId, dateRange]);

  useEffect(() => { load(); }, [load]);

  // Client-side filter on top of server-fetched data (instant UX)
  const filtered = useMemo(() => {
    if (!localTargets.length) return [];
    return localTargets.filter((t) => {
      if (filters.search) {
        const q = filters.search.toLowerCase();
        if (!t.value.toLowerCase().includes(q) &&
            !t.campaignName.toLowerCase().includes(q) &&
            !t.adGroupName.toLowerCase().includes(q)) return false;
      }
      if (filters.campaignIds.length && !filters.campaignIds.includes(t.campaignId)) return false;
      if (filters.targetType !== "ALL" && t.type !== filters.targetType) return false;
      if (filters.matchType  !== "ALL" && t.matchType !== filters.matchType) return false;
      if (filters.status     !== "ALL" && t.status !== filters.status) return false;
      if (filters.bidMin  && t.bid   < parseFloat(filters.bidMin))  return false;
      if (filters.bidMax  && t.bid   > parseFloat(filters.bidMax))  return false;
      if (filters.acosMin && t.acos  < parseFloat(filters.acosMin)) return false;
      if (filters.acosMax && t.acos  > parseFloat(filters.acosMax)) return false;
      if (filters.spendMin && t.spend < parseFloat(filters.spendMin)) return false;
      return true;
    });
  }, [localTargets, filters]);

  // ── Mutations ────────────────────────────────────────────────────────────────

  const handleBidChange = useCallback(async (id: string, bid: number) => {
    // Optimistic update
    setLocalTargets((prev) => prev.map((t) => t.id === id ? { ...t, bid } : t));
    if (activeTarget?.id === id) setActiveTarget((p) => p ? { ...p, bid } : p);

    if (!isMock) {
      setSaving(true);
      try {
        const target = localTargets.find((t) => t.id === id);
        await updateTargetBid(profileId, id, target?.type ?? "KEYWORD", bid, accountId || undefined);
        showToast(`Bid updated → $${bid.toFixed(2)}`);
      } catch (e) {
        showToast(String(e), "error");
        // Rollback
        setLocalTargets((prev) => prev.map((t) => t.id === id ? { ...t, bid: t.bid } : t));
      } finally {
        setSaving(false);
      }
    } else {
      showToast(`Bid updated → $${bid.toFixed(2)}`);
    }
  }, [isMock, localTargets, profileId, activeTarget]);

  const handleStatusChange = useCallback(async (id: string, status: Target["status"]) => {
    setLocalTargets((prev) => prev.map((t) => t.id === id ? { ...t, status } : t));
    if (activeTarget?.id === id) setActiveTarget((p) => p ? { ...p, status } : p);

    if (!isMock) {
      try {
        const target = localTargets.find((t) => t.id === id);
        await updateTargetStatus(profileId, id, target?.type ?? "KEYWORD", status, accountId || undefined);
        showToast(`Target ${status === "ENABLED" ? "enabled" : "paused"}`);
      } catch (e) {
        showToast(String(e), "error");
        // Rollback
        const orig = localTargets.find((t) => t.id === id);
        if (orig) setLocalTargets((prev) => prev.map((t) => t.id === id ? orig : t));
      }
    } else {
      showToast(`Target ${status === "ENABLED" ? "enabled" : "paused"}`);
    }
  }, [isMock, localTargets, profileId, accountId, activeTarget]);

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleToggleSelectAll = useCallback((ids: string[]) => {
    setSelectedIds(ids.length ? new Set(ids) : new Set());
  }, []);

  const handleBulkStatusAction = async (action: "enable" | "pause" | "archive") => {
    const newStatus = action === "enable" ? "ENABLED" : action === "pause" ? "PAUSED" : "ARCHIVED";
    const ids = Array.from(selectedIds);

    // Optimistic
    setLocalTargets((prev) => prev.map((t) =>
      ids.includes(t.id) ? { ...t, status: newStatus as Target["status"] } : t
    ));

    if (!isMock) {
      try {
        const targets = localTargets.filter((t) => ids.includes(t.id))
          .map((t) => ({ id: t.id, type: t.type }));
        await bulkUpdateTargets({ profileId, accountId: accountId || undefined, targets, action });
        showToast(`${ids.length} targets ${action}d`);
      } catch (e) {
        showToast(String(e), "error");
      }
    } else {
      showToast(`${ids.length} targets ${action}d`);
    }
    setSelectedIds(new Set());
  };

  const handleBulkBid = async (
    type: "exact" | "increase" | "decrease" | "suggested",
    value: number
  ) => {
    const ids = Array.from(selectedIds);
    const actionMap = {
      exact: "bid_exact", increase: "bid_increase_pct",
      decrease: "bid_decrease_pct", suggested: "bid_suggested",
    } as const;

    const currentBids = Object.fromEntries(
      localTargets.filter((t) => ids.includes(t.id)).map((t) => [t.id, t.bid])
    );
    const suggestedBids = Object.fromEntries(
      localTargets.filter((t) => ids.includes(t.id)).map((t) => [t.id, t.suggestedBid])
    );

    // Optimistic update
    setLocalTargets((prev) => prev.map((t) => {
      if (!ids.includes(t.id)) return t;
      let newBid = t.bid;
      if (type === "exact")    newBid = value;
      if (type === "increase") newBid = Math.round(t.bid * (1 + value / 100) * 100) / 100;
      if (type === "decrease") newBid = Math.max(0.02, Math.round(t.bid * (1 - value / 100) * 100) / 100);
      if (type === "suggested") newBid = t.suggestedBid;
      return { ...t, bid: newBid };
    }));

    if (!isMock) {
      try {
        const targets = localTargets.filter((t) => ids.includes(t.id))
          .map((t) => ({ id: t.id, type: t.type }));
        await bulkUpdateTargets({
          profileId,
          accountId: accountId || undefined,
          targets,
          action: actionMap[type],
          bidValue: value,
          currentBids,
          suggestedBids,
        });
        showToast(`Bid updated for ${ids.length} targets`);
      } catch (e) {
        showToast(String(e), "error");
      }
    } else {
      showToast(`Bid updated for ${ids.length} targets`);
    }
    setSelectedIds(new Set());
  };

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
              Targeting 360
            </h1>
            <p style={{ fontSize: 12, color: "#8892a4", marginTop: 2 }}>
              {loading ? "Loading…" : (
                <>
                  <span style={{ color: "#e2e8f0", fontWeight: 600 }}>
                    {apiData?.totalCount?.toLocaleString() ?? 0}
                  </span>{" "}
                  targets across all campaigns
                  {saving && <span style={{ color: "#f59e0b", marginLeft: 8 }}>● Saving…</span>}
                </>
              )}
            </p>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            {/* Date range */}
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

            {/* Refresh */}
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
              <span style={{ display: "inline-block", animation: loading ? "spin 1s linear infinite" : "none" }}>↻</span>
              {loading ? "Loading…" : "Refresh"}
            </button>

            <button style={{
              padding: "7px 16px", borderRadius: 7, background: "#6366f1",
              border: "none", color: "#fff", fontSize: 13, fontWeight: 600,
              cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add Target
            </button>
          </div>
        </div>

        {/* Mock banner */}
        {isMock && !loading && <MockBanner />}

        {/* Error */}
        {error && (
          <div style={{
            background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)",
            borderRadius: 8, padding: "12px 16px", marginBottom: 16,
            fontSize: 13, color: "#ef4444",
          }}>
            ⚠ {error}
            <button onClick={load} style={{ marginLeft: 12, color: "#6366f1", background: "transparent", border: "none", cursor: "pointer", fontSize: 12 }}>
              Retry
            </button>
          </div>
        )}

        {/* Filters */}
        <TargetingFiltersBar
          filters={filters}
          onChange={(partial) => setFilters((prev) => ({ ...prev, ...partial }))}
          campaigns={campaignList}
        />

        {/* Bulk actions bar */}
        {selectedIds.size > 0 && (
          <div style={{
            background: "#1c2333", border: "1px solid #6366f140",
            borderRadius: 8, padding: "10px 16px", marginBottom: 12,
            display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#6366f1", marginRight: 4 }}>
              ✓ {selectedIds.size} selected
            </span>
            <BulkBtn onClick={() => setShowBidModal(true)}>⚡ Change Bid</BulkBtn>
            <BulkBtn onClick={() => handleBulkStatusAction("enable")}  color="success">● Enable</BulkBtn>
            <BulkBtn onClick={() => handleBulkStatusAction("pause")}   color="warning">⏸ Pause</BulkBtn>
            <BulkBtn onClick={() => handleBulkStatusAction("archive")} color="danger">Archive</BulkBtn>
            <BulkBtn>Add Negative</BulkBtn>
            <BulkBtn>↓ Export</BulkBtn>
            <button
              onClick={() => setSelectedIds(new Set())}
              style={{ marginLeft: "auto", padding: "5px 10px", borderRadius: 5, background: "transparent", border: "none", color: "#555f6e", cursor: "pointer", fontSize: 12 }}
            >
              ✕ Clear
            </button>
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div style={{ background: "#161b27", border: "1px solid #2a3245", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ padding: "10px 16px", borderBottom: "1px solid #2a3245", background: "#0d1117" }}>
              <div style={{ height: 12, width: 200, background: "#1c2333", borderRadius: 4 }} />
            </div>
            <table style={{ width: "100%" }}>
              <tbody>
                {Array.from({ length: 12 }).map((_, i) => <TableRowSkeleton key={i} cols={16} />)}
              </tbody>
            </table>
          </div>
        ) : (
          <TargetingTable
            targets={filtered}
            onSelectTarget={setActiveTarget}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
            onToggleSelectAll={handleToggleSelectAll}
            onStatusChange={handleStatusChange}
            onBidChange={handleBidChange}
          />
        )}
      </main>

      {/* Detail drawer */}
      <TargetDetailDrawer
        target={activeTarget}
        onClose={() => setActiveTarget(null)}
        onBidChange={handleBidChange}
      />

      {/* Bulk bid modal */}
      {showBidModal && (
        <ChangeBidModal
          count={selectedIds.size}
          onApply={(type, value) => { handleBulkBid(type, value); }}
          onClose={() => setShowBidModal(false)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 24, right: 24,
          background: "#1c2333", border: `1px solid ${toast.type === "error" ? "rgba(239,68,68,0.3)" : "#2a3245"}`,
          borderRadius: 8, padding: "12px 18px", fontSize: 13, color: "#e2e8f0",
          zIndex: 500, boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <span style={{ color: toast.type === "error" ? "#ef4444" : "#22c55e" }}>
            {toast.type === "error" ? "✕" : "✓"}
          </span>
          {toast.msg}
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function BulkBtn({ children, onClick, color }: {
  children: React.ReactNode;
  onClick?: () => void;
  color?: "success" | "warning" | "danger";
}) {
  const colors = {
    success: { bg: "rgba(34,197,94,0.12)",  border: "rgba(34,197,94,0.25)",  text: "#22c55e" },
    warning: { bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.25)", text: "#f59e0b" },
    danger:  { bg: "rgba(239,68,68,0.1)",   border: "rgba(239,68,68,0.2)",   text: "#ef4444" },
  };
  const s = color ? colors[color] : { bg: "#1c2333", border: "#2a3245", text: "#8892a4" };
  return (
    <button onClick={onClick} style={{
      padding: "5px 12px", borderRadius: 6,
      background: s.bg, border: `1px solid ${s.border}`,
      color: s.text, fontSize: 12, fontWeight: 500, cursor: "pointer",
    }}>
      {children}
    </button>
  );
}
