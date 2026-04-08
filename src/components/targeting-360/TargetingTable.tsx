"use client";
import { useState, useMemo, useCallback } from "react";
import type { Target } from "@/lib/types";
import { fmt, acosColor, acosBg } from "@/lib/utils";
import Sparkline from "./Sparkline";

type SortKey = keyof Target;

const TYPE_LABELS: Record<Target["type"], string> = {
  KEYWORD: "KW", ASIN: "ASIN", CATEGORY: "CAT", AUTO: "AUTO",
};
const TYPE_COLORS: Record<Target["type"], { bg: string; color: string }> = {
  KEYWORD: { bg: "rgba(99,102,241,0.15)", color: "#6366f1" },
  ASIN:    { bg: "rgba(139,92,246,0.15)", color: "#8b5cf6" },
  CATEGORY:{ bg: "rgba(34,197,94,0.12)", color: "#22c55e" },
  AUTO:    { bg: "rgba(85,95,110,0.15)", color: "#8892a4" },
};
const MATCH_COLORS: Record<Target["matchType"], string> = {
  EXACT: "#6366f1", PHRASE: "#8b5cf6", BROAD: "#a78bfa", AUTO: "#555f6e",
};

interface Props {
  targets: Target[];
  onSelectTarget: (t: Target) => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: (ids: string[]) => void;
  onStatusChange: (id: string, status: Target["status"]) => void;
  onBidChange: (id: string, bid: number) => void;
}

export default function TargetingTable({
  targets,
  onSelectTarget,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onStatusChange,
  onBidChange,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [editingBidId, setEditingBidId] = useState<string | null>(null);
  const [editingBidVal, setEditingBidVal] = useState("");

  const sorted = useMemo(() => {
    return [...targets].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "string") return sortDir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [targets, sortKey, sortDir]);

  const totalPages = Math.ceil(sorted.length / pageSize);
  const visible = sorted.slice(page * pageSize, (page + 1) * pageSize);
  const visibleIds = visible.map((t) => t.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("desc"); }
    setPage(0);
  };

  const saveBid = useCallback((id: string) => {
    const v = parseFloat(editingBidVal);
    if (!isNaN(v) && v > 0) onBidChange(id, v);
    setEditingBidId(null);
    setEditingBidVal("");
  }, [editingBidVal, onBidChange]);

  const Th = ({ k, label, right }: { k?: SortKey; label: string; right?: boolean }) => (
    <th
      onClick={k ? () => toggleSort(k) : undefined}
      style={{
        padding: "9px 10px",
        cursor: k ? "pointer" : "default",
        whiteSpace: "nowrap",
        color: k && sortKey === k ? "#e2e8f0" : "#555f6e",
        fontWeight: 500,
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        textAlign: right ? "right" : "left",
        userSelect: "none",
        background: "#161b27",
        borderBottom: "1px solid #2a3245",
        position: "sticky",
        top: 0,
        zIndex: 1,
      }}
    >
      {label}{k && sortKey === k ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
    </th>
  );

  // Summary totals
  const totals = useMemo(() => ({
    spend: targets.reduce((s, t) => s + t.spend, 0),
    revenue: targets.reduce((s, t) => s + t.revenue, 0),
    orders: targets.reduce((s, t) => s + t.orders, 0),
    clicks: targets.reduce((s, t) => s + t.clicks, 0),
    impressions: targets.reduce((s, t) => s + t.impressions, 0),
  }), [targets]);

  const avgAcos = totals.revenue > 0 ? (totals.spend / totals.revenue) * 100 : 0;
  const avgRoas = totals.spend > 0 ? totals.revenue / totals.spend : 0;

  return (
    <div style={{
      background: "#161b27",
      border: "1px solid #2a3245",
      borderRadius: 10,
      overflow: "hidden",
    }}>
      {/* Summary bar */}
      <div style={{
        padding: "10px 16px",
        borderBottom: "1px solid #2a3245",
        display: "flex",
        alignItems: "center",
        gap: 20,
        flexWrap: "wrap",
        background: "#0d1117",
      }}>
        <span style={{ fontSize: 11, color: "#8892a4" }}>
          Showing <strong style={{ color: "#e2e8f0" }}>{targets.length.toLocaleString()}</strong> targets
        </span>
        {[
          { label: "Spend", val: fmt(totals.spend, "currency") },
          { label: "Revenue", val: fmt(totals.revenue, "currency") },
          { label: "ACOS", val: fmt(avgAcos, "percent"), color: acosColor(avgAcos) },
          { label: "ROAS", val: fmt(avgRoas, "multiplier") },
          { label: "Orders", val: fmt(totals.orders, "number") },
        ].map((m) => (
          <span key={m.label} style={{ fontSize: 11, color: "#555f6e" }}>
            {m.label}: <strong style={{ color: m.color || "#e2e8f0", fontSize: 12 }}>{m.val}</strong>
          </span>
        ))}
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: "#555f6e" }}>Rows:</span>
          <select
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
            style={{
              background: "#1c2333", border: "1px solid #2a3245",
              borderRadius: 5, color: "#8892a4", padding: "3px 6px", fontSize: 11, cursor: "pointer",
            }}
          >
            {[25, 50, 100].map((n) => <option key={n}>{n}</option>)}
          </select>
          <button style={{
            padding: "4px 10px", borderRadius: 5, background: "#1c2333",
            border: "1px solid #2a3245", color: "#8892a4", fontSize: 11, cursor: "pointer",
          }}>
            ↓ Export
          </button>
        </div>
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto", maxHeight: "calc(100vh - 360px)", overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {/* Checkbox */}
              <th style={{
                padding: "9px 10px", background: "#161b27", borderBottom: "1px solid #2a3245",
                position: "sticky", top: 0, zIndex: 1, width: 36,
              }}>
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={() => onToggleSelectAll(allVisibleSelected ? [] : visibleIds)}
                  style={{ accentColor: "#6366f1", cursor: "pointer" }}
                />
              </th>
              <Th k="value" label="Target" />
              <Th label="Type" />
              <Th label="Match" />
              <Th k="campaignName" label="Campaign" />
              <Th k="adGroupName" label="Ad Group" />
              <Th label="Status" />
              <Th k="bid" label="Bid" right />
              <Th k="impressions" label="Impr." right />
              <Th k="clicks" label="Clicks" right />
              <Th k="ctr" label="CTR" right />
              <Th k="spend" label="Spend" right />
              <Th k="orders" label="Orders" right />
              <Th k="revenue" label="Revenue" right />
              <Th k="acos" label="ACOS" right />
              <Th k="roas" label="ROAS" right />
              <Th k="cpc" label="CPC" right />
              <Th k="cvr" label="CVR" right />
              <Th label="7D Trend" />
              <th style={{
                padding: "9px 10px", background: "#161b27", borderBottom: "1px solid #2a3245",
                position: "sticky", top: 0, zIndex: 1, color: "#555f6e",
                fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em",
              }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((t, i) => {
              const selected = selectedIds.has(t.id);
              return (
                <tr
                  key={t.id}
                  style={{
                    borderBottom: "1px solid #1a2035",
                    background: selected ? "#6366f108" : i % 2 === 0 ? "transparent" : "#0d1117",
                    transition: "background 0.1s",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => { if (!selected) (e.currentTarget as HTMLTableRowElement).style.background = "#1c2333"; }}
                  onMouseLeave={(e) => { if (!selected) (e.currentTarget as HTMLTableRowElement).style.background = i % 2 === 0 ? "transparent" : "#0d1117"; }}
                >
                  {/* Checkbox */}
                  <td style={{ padding: "8px 10px" }} onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => onToggleSelect(t.id)}
                      style={{ accentColor: "#6366f1", cursor: "pointer" }}
                    />
                  </td>

                  {/* Target value */}
                  <td
                    style={{ padding: "8px 10px", maxWidth: 200, cursor: "pointer" }}
                    onClick={() => onSelectTarget(t)}
                  >
                    <span style={{
                      fontSize: 12, color: "#e2e8f0",
                      display: "block", overflow: "hidden",
                      textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {t.value}
                    </span>
                  </td>

                  {/* Type badge */}
                  <td style={{ padding: "8px 10px" }}>
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding: "2px 5px",
                      borderRadius: 3,
                      background: TYPE_COLORS[t.type].bg,
                      color: TYPE_COLORS[t.type].color,
                    }}>
                      {TYPE_LABELS[t.type]}
                    </span>
                  </td>

                  {/* Match type */}
                  <td style={{ padding: "8px 10px" }}>
                    {t.matchType !== "AUTO" ? (
                      <span style={{
                        fontSize: 9, fontWeight: 600, padding: "2px 5px",
                        borderRadius: 3,
                        background: `${MATCH_COLORS[t.matchType]}20`,
                        color: MATCH_COLORS[t.matchType],
                      }}>
                        {t.matchType}
                      </span>
                    ) : <span style={{ color: "#555f6e", fontSize: 11 }}>—</span>}
                  </td>

                  {/* Campaign */}
                  <td style={{ padding: "8px 10px", maxWidth: 160 }}>
                    <span style={{
                      fontSize: 11, color: "#8892a4",
                      display: "block", overflow: "hidden",
                      textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }} title={t.campaignName}>
                      {t.campaignName}
                    </span>
                  </td>

                  {/* Ad Group */}
                  <td style={{ padding: "8px 10px", maxWidth: 120 }}>
                    <span style={{
                      fontSize: 11, color: "#555f6e",
                      display: "block", overflow: "hidden",
                      textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {t.adGroupName}
                    </span>
                  </td>

                  {/* Status toggle */}
                  <td style={{ padding: "8px 10px" }} onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => onStatusChange(t.id, t.status === "ENABLED" ? "PAUSED" : "ENABLED")}
                      style={{
                        fontSize: 10, fontWeight: 500, padding: "3px 8px",
                        borderRadius: 10, cursor: "pointer", border: "none",
                        background: t.status === "ENABLED" ? "rgba(34,197,94,0.12)" : "rgba(245,158,11,0.12)",
                        color: t.status === "ENABLED" ? "#22c55e" : t.status === "PAUSED" ? "#f59e0b" : "#555f6e",
                        transition: "opacity 0.15s",
                      }}
                    >
                      {t.status === "ENABLED" ? "● On" : t.status === "PAUSED" ? "⏸ Paused" : "✕ Archived"}
                    </button>
                  </td>

                  {/* Bid (inline edit) */}
                  <td style={{ padding: "8px 10px", textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                    {editingBidId === t.id ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
                        <input
                          type="number"
                          value={editingBidVal}
                          onChange={(e) => setEditingBidVal(e.target.value)}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveBid(t.id);
                            if (e.key === "Escape") { setEditingBidId(null); setEditingBidVal(""); }
                          }}
                          style={{
                            width: 60, background: "#1c2333", border: "1px solid #6366f1",
                            borderRadius: 4, color: "#e2e8f0", padding: "2px 5px", fontSize: 12, textAlign: "right",
                          }}
                        />
                        <button onClick={() => saveBid(t.id)} style={{ background: "#6366f1", border: "none", borderRadius: 4, color: "#fff", padding: "3px 6px", cursor: "pointer", fontSize: 11 }}>✓</button>
                        <button onClick={() => { setEditingBidId(null); setEditingBidVal(""); }} style={{ background: "#1c2333", border: "1px solid #2a3245", borderRadius: 4, color: "#8892a4", padding: "3px 5px", cursor: "pointer", fontSize: 11 }}>✕</button>
                      </div>
                    ) : (
                      <span
                        onClick={() => { setEditingBidId(t.id); setEditingBidVal(String(t.bid)); }}
                        title={`Suggested: ₹${t.suggestedBid}`}
                        style={{ fontSize: 12, color: "#e2e8f0", cursor: "text", borderBottom: "1px dashed #2a3245", paddingBottom: 1 }}
                      >
                        ₹{t.bid.toFixed(2)}
                      </span>
                    )}
                  </td>

                  {/* Metrics */}
                  <Metric val={fmt(t.impressions, "compact")} right muted />
                  <Metric val={fmt(t.clicks, "compact")} right muted />
                  <Metric val={fmt(t.ctr, "percent")} right muted />
                  <Metric val={fmt(t.spend, "currency")} right />
                  <Metric val={fmt(t.orders, "number")} right />
                  <Metric val={fmt(t.revenue, "currency")} right />

                  {/* ACOS */}
                  <td style={{ padding: "8px 10px", textAlign: "right" }}>
                    <span style={{
                      fontSize: 11, fontWeight: 600,
                      color: acosColor(t.acos),
                      background: acosBg(t.acos),
                      padding: "2px 7px", borderRadius: 4,
                    }}>
                      {t.acos > 0 ? fmt(t.acos, "percent") : "—"}
                    </span>
                  </td>

                  <Metric val={t.roas > 0 ? fmt(t.roas, "multiplier") : "—"} right />
                  <Metric val={t.cpc > 0 ? fmt(t.cpc, "currency") : "—"} right muted />
                  <Metric val={t.cvr > 0 ? fmt(t.cvr, "percent") : "—"} right muted />

                  {/* Sparkline */}
                  <td style={{ padding: "8px 10px" }}>
                    <Sparkline data={t.trend7d} color="#f59e0b" width={56} height={20} />
                  </td>

                  {/* Actions */}
                  <td style={{ padding: "8px 10px" }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <ActionBtn title="View details" onClick={() => onSelectTarget(t)}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="3" /><path d="M2 12s3.636-8 10-8 10 8 10 8-3.636 8-10 8S2 12 2 12z" />
                        </svg>
                      </ActionBtn>
                      <ActionBtn title="Edit bid" onClick={() => { setEditingBidId(t.id); setEditingBidVal(String(t.bid)); }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </ActionBtn>
                      <ActionBtn title="Add negative" danger>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                        </svg>
                      </ActionBtn>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div style={{
        padding: "10px 16px",
        borderTop: "1px solid #2a3245",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <span style={{ fontSize: 11, color: "#555f6e" }}>
          {page * pageSize + 1}–{Math.min((page + 1) * pageSize, sorted.length)} of {sorted.length} targets
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          <PaginationBtn onClick={() => setPage(0)} disabled={page === 0}>«</PaginationBtn>
          <PaginationBtn onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}>‹ Prev</PaginationBtn>
          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            const p = Math.max(0, Math.min(totalPages - 5, page - 2)) + i;
            return (
              <PaginationBtn key={p} onClick={() => setPage(p)} active={p === page}>
                {p + 1}
              </PaginationBtn>
            );
          })}
          <PaginationBtn onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}>Next ›</PaginationBtn>
          <PaginationBtn onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1}>»</PaginationBtn>
        </div>
      </div>
    </div>
  );
}

function Metric({ val, right, muted }: { val: string; right?: boolean; muted?: boolean }) {
  return (
    <td style={{ padding: "8px 10px", textAlign: right ? "right" : "left" }}>
      <span style={{ fontSize: 12, color: muted ? "#8892a4" : "#e2e8f0" }}>{val}</span>
    </td>
  );
}

function ActionBtn({ children, title, onClick, danger }: {
  children: React.ReactNode;
  title?: string;
  onClick?: () => void;
  danger?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        padding: "4px",
        borderRadius: 4,
        background: "transparent",
        border: "1px solid #2a3245",
        color: danger ? "#ef4444" : "#8892a4",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "all 0.1s",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "#1c2333";
        (e.currentTarget as HTMLButtonElement).style.borderColor = "#3a4560";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
        (e.currentTarget as HTMLButtonElement).style.borderColor = "#2a3245";
      }}
    >
      {children}
    </button>
  );
}

function PaginationBtn({ children, onClick, disabled, active }: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "4px 9px",
        borderRadius: 5,
        background: active ? "#6366f1" : "#1c2333",
        border: `1px solid ${active ? "#6366f1" : "#2a3245"}`,
        color: disabled ? "#555f6e" : active ? "#fff" : "#8892a4",
        fontSize: 11,
        cursor: disabled ? "default" : "pointer",
        transition: "all 0.1s",
      }}
    >
      {children}
    </button>
  );
}
