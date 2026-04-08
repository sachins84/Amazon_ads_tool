"use client";
import { useState, useMemo } from "react";
import type { CampaignRow, CampaignType } from "@/lib/types";
import { fmt, acosColor, acosBg } from "@/lib/utils";

interface Props {
  campaigns: CampaignRow[];
}

const TYPE_COLORS: Record<CampaignType, { bg: string; color: string }> = {
  SP: { bg: "rgba(99,102,241,0.15)", color: "#6366f1" },
  SB: { bg: "rgba(139,92,246,0.15)", color: "#8b5cf6" },
  SD: { bg: "rgba(167,139,250,0.15)", color: "#a78bfa" },
};

type SortKey = keyof CampaignRow;

export default function CampaignTable({ campaigns }: Props) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"ALL" | CampaignType>("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ENABLED" | "PAUSED">("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const pageSize = 10;

  const filtered = useMemo(() => {
    return campaigns
      .filter((c) => {
        if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
        if (typeFilter !== "ALL" && c.type !== typeFilter) return false;
        if (statusFilter !== "ALL" && c.status !== statusFilter) return false;
        return true;
      })
      .sort((a, b) => {
        const av = a[sortKey] as number;
        const bv = b[sortKey] as number;
        if (typeof av === "string") return sortDir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
        return sortDir === "asc" ? av - bv : bv - av;
      });
  }, [campaigns, search, typeFilter, statusFilter, sortKey, sortDir]);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const visible = filtered.slice(page * pageSize, (page + 1) * pageSize);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
    setPage(0);
  };

  const SortBtn = ({ k, label }: { k: SortKey; label: string }) => (
    <th
      onClick={() => toggleSort(k)}
      style={{
        padding: "10px 12px",
        cursor: "pointer",
        whiteSpace: "nowrap",
        color: sortKey === k ? "#e2e8f0" : "#8892a4",
        fontWeight: 500,
        fontSize: 11,
        userSelect: "none",
      }}
    >
      {label} {sortKey === k ? (sortDir === "asc" ? "↑" : "↓") : ""}
    </th>
  );

  return (
    <div style={{
      background: "#161b27",
      border: "1px solid #2a3245",
      borderRadius: 10,
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        padding: "16px 20px",
        borderBottom: "1px solid #2a3245",
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
      }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", flex: 1 }}>
          Campaign Performance
          <span style={{ marginLeft: 8, fontSize: 11, color: "#8892a4", fontWeight: 400 }}>
            {filtered.length} campaigns
          </span>
        </h3>

        {/* Search */}
        <div style={{ position: "relative" }}>
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search campaigns…"
            style={{
              background: "#1c2333",
              border: "1px solid #2a3245",
              borderRadius: 6,
              color: "#e2e8f0",
              padding: "5px 10px 5px 28px",
              fontSize: 12,
              width: 180,
            }}
          />
          <svg style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)" }}
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#555f6e" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>

        {/* Type pills */}
        <div style={{ display: "flex", gap: 4 }}>
          {(["ALL", "SP", "SB", "SD"] as const).map((t) => (
            <button
              key={t}
              onClick={() => { setTypeFilter(t); setPage(0); }}
              style={{
                padding: "4px 10px",
                borderRadius: 5,
                fontSize: 11,
                fontWeight: 500,
                cursor: "pointer",
                border: "1px solid",
                borderColor: typeFilter === t ? "#6366f1" : "#2a3245",
                background: typeFilter === t ? "#6366f120" : "transparent",
                color: typeFilter === t ? "#6366f1" : "#8892a4",
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Status */}
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value as "ALL" | "ENABLED" | "PAUSED"); setPage(0); }}
          style={{
            background: "#1c2333",
            border: "1px solid #2a3245",
            borderRadius: 6,
            color: "#8892a4",
            padding: "5px 8px",
            fontSize: 12,
          }}
        >
          <option value="ALL">All Status</option>
          <option value="ENABLED">Active</option>
          <option value="PAUSED">Paused</option>
        </select>
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #2a3245", background: "#161b27" }}>
              <SortBtn k="name" label="Campaign" />
              <th style={{ padding: "10px 12px", color: "#8892a4", fontWeight: 500, fontSize: 11 }}>Type</th>
              <th style={{ padding: "10px 12px", color: "#8892a4", fontWeight: 500, fontSize: 11 }}>Status</th>
              <SortBtn k="spend" label="Spend" />
              <SortBtn k="revenue" label="Revenue" />
              <SortBtn k="acos" label="ACOS" />
              <SortBtn k="roas" label="ROAS" />
              <SortBtn k="orders" label="Orders" />
              <SortBtn k="impressions" label="Impressions" />
              <SortBtn k="clicks" label="Clicks" />
              <SortBtn k="ctr" label="CTR" />
              <SortBtn k="cpc" label="CPC" />
              <SortBtn k="cvr" label="CVR" />
            </tr>
          </thead>
          <tbody>
            {visible.map((c, i) => (
              <tr
                key={c.id}
                style={{
                  borderBottom: "1px solid #1e2a3a",
                  background: i % 2 === 0 ? "transparent" : "#0d1117",
                  transition: "background 0.1s",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#1c2333")}
                onMouseLeave={(e) => (e.currentTarget.style.background = i % 2 === 0 ? "transparent" : "#0d1117")}
              >
                <td style={{ padding: "10px 12px", maxWidth: 240 }}>
                  <span style={{ fontSize: 12, color: "#e2e8f0", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.name}
                  </span>
                </td>
                <td style={{ padding: "10px 12px" }}>
                  <span style={{
                    fontSize: 10,
                    fontWeight: 600,
                    padding: "2px 7px",
                    borderRadius: 4,
                    background: TYPE_COLORS[c.type].bg,
                    color: TYPE_COLORS[c.type].color,
                  }}>
                    {c.type}
                  </span>
                </td>
                <td style={{ padding: "10px 12px" }}>
                  <span style={{
                    fontSize: 10,
                    fontWeight: 500,
                    padding: "2px 7px",
                    borderRadius: 10,
                    background: c.status === "ENABLED" ? "rgba(34,197,94,0.12)" : "rgba(245,158,11,0.12)",
                    color: c.status === "ENABLED" ? "#22c55e" : "#f59e0b",
                  }}>
                    {c.status === "ENABLED" ? "● Active" : "⏸ Paused"}
                  </span>
                </td>
                <td style={{ padding: "10px 12px", fontSize: 12, color: "#e2e8f0" }}>{fmt(c.spend, "currency")}</td>
                <td style={{ padding: "10px 12px", fontSize: 12, color: "#e2e8f0" }}>{fmt(c.revenue, "currency")}</td>
                <td style={{ padding: "10px 12px" }}>
                  <span style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: acosColor(c.acos),
                    background: acosBg(c.acos),
                    padding: "2px 8px",
                    borderRadius: 4,
                  }}>
                    {fmt(c.acos, "percent")}
                  </span>
                </td>
                <td style={{ padding: "10px 12px", fontSize: 12, color: "#e2e8f0" }}>{fmt(c.roas, "multiplier")}</td>
                <td style={{ padding: "10px 12px", fontSize: 12, color: "#e2e8f0" }}>{fmt(c.orders, "number")}</td>
                <td style={{ padding: "10px 12px", fontSize: 12, color: "#8892a4" }}>{fmt(c.impressions, "compact")}</td>
                <td style={{ padding: "10px 12px", fontSize: 12, color: "#8892a4" }}>{fmt(c.clicks, "compact")}</td>
                <td style={{ padding: "10px 12px", fontSize: 12, color: "#8892a4" }}>{fmt(c.ctr, "percent")}</td>
                <td style={{ padding: "10px 12px", fontSize: 12, color: "#8892a4" }}>{fmt(c.cpc, "currency")}</td>
                <td style={{ padding: "10px 12px", fontSize: 12, color: "#8892a4" }}>{fmt(c.cvr, "percent")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div style={{
        padding: "12px 20px",
        borderTop: "1px solid #2a3245",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <span style={{ fontSize: 11, color: "#555f6e" }}>
          Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, filtered.length)} of {filtered.length}
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
            style={{
              padding: "4px 10px",
              borderRadius: 5,
              background: "#1c2333",
              border: "1px solid #2a3245",
              color: page === 0 ? "#555f6e" : "#e2e8f0",
              fontSize: 11,
              cursor: page === 0 ? "default" : "pointer",
            }}
          >
            ← Prev
          </button>
          <span style={{ padding: "4px 10px", fontSize: 11, color: "#8892a4" }}>
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
            disabled={page >= totalPages - 1}
            style={{
              padding: "4px 10px",
              borderRadius: 5,
              background: "#1c2333",
              border: "1px solid #2a3245",
              color: page >= totalPages - 1 ? "#555f6e" : "#e2e8f0",
              fontSize: 11,
              cursor: page >= totalPages - 1 ? "default" : "pointer",
            }}
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}
