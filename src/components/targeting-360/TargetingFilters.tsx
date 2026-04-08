"use client";
import type { TargetingFilters, TargetType, MatchType, TargetStatus } from "@/lib/types";
import { useState } from "react";

interface Props {
  filters: TargetingFilters;
  onChange: (f: Partial<TargetingFilters>) => void;
  campaigns: { id: string; name: string }[];
}

export default function TargetingFiltersBar({ filters, onChange, campaigns }: Props) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const hasActiveFilters =
    filters.search || filters.campaignIds.length || filters.targetType !== "ALL" ||
    filters.matchType !== "ALL" || filters.status !== "ALL" ||
    filters.bidMin || filters.bidMax || filters.acosMin || filters.acosMax || filters.spendMin;

  const clearAll = () => onChange({
    search: "", campaignIds: [], adGroupIds: [],
    targetType: "ALL", matchType: "ALL", status: "ALL",
    bidMin: "", bidMax: "", acosMin: "", acosMax: "", spendMin: "",
  });

  return (
    <div style={{
      background: "#161b27",
      border: "1px solid #2a3245",
      borderRadius: 10,
      padding: "14px 16px",
      marginBottom: 16,
    }}>
      {/* Row 1 */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        {/* Search */}
        <div style={{ position: "relative", flex: "1 1 220px" }}>
          <input
            value={filters.search}
            onChange={(e) => onChange({ search: e.target.value })}
            placeholder="Search keyword, ASIN, or category…"
            style={{
              width: "100%",
              background: "#1c2333",
              border: "1px solid #2a3245",
              borderRadius: 7,
              color: "#e2e8f0",
              padding: "7px 12px 7px 32px",
              fontSize: 12,
            }}
          />
          <svg style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }}
            width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#555f6e" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>

        {/* Campaign multi-select */}
        <select
          multiple={false}
          value={filters.campaignIds[0] || ""}
          onChange={(e) => onChange({ campaignIds: e.target.value ? [e.target.value] : [] })}
          style={{
            background: "#1c2333",
            border: `1px solid ${filters.campaignIds.length ? "#6366f1" : "#2a3245"}`,
            borderRadius: 7,
            color: filters.campaignIds.length ? "#e2e8f0" : "#8892a4",
            padding: "6px 10px",
            fontSize: 12,
            flex: "1 1 180px",
            cursor: "pointer",
          }}
        >
          <option value="">All Campaigns</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>{c.name.slice(0, 30)}</option>
          ))}
        </select>

        {/* Date range inline */}
        <select
          style={{
            background: "#1c2333",
            border: "1px solid #2a3245",
            borderRadius: 7,
            color: "#8892a4",
            padding: "6px 10px",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          <option>Last 30D</option>
          <option>Last 7D</option>
          <option>Last 14D</option>
          <option>This Month</option>
          <option>Custom</option>
        </select>
      </div>

      {/* Row 2 */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        {/* Target Type */}
        <FilterPills
          label="Type"
          options={["ALL", "KEYWORD", "ASIN", "CATEGORY", "AUTO"]}
          labels={{ ALL: "All", KEYWORD: "Keyword", ASIN: "ASIN", CATEGORY: "Category", AUTO: "Auto" }}
          value={filters.targetType}
          onChange={(v) => onChange({ targetType: v as TargetType | "ALL" })}
        />

        {/* Match Type */}
        <FilterPills
          label="Match"
          options={["ALL", "EXACT", "PHRASE", "BROAD"]}
          labels={{ ALL: "All", EXACT: "Exact", PHRASE: "Phrase", BROAD: "Broad" }}
          value={filters.matchType}
          onChange={(v) => onChange({ matchType: v as MatchType | "ALL" })}
        />

        {/* Status */}
        <FilterPills
          label="Status"
          options={["ALL", "ENABLED", "PAUSED", "ARCHIVED"]}
          labels={{ ALL: "All", ENABLED: "Active", PAUSED: "Paused", ARCHIVED: "Archived" }}
          value={filters.status}
          onChange={(v) => onChange({ status: v as TargetStatus | "ALL" })}
        />

        {/* More filters toggle */}
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          style={{
            padding: "5px 12px",
            borderRadius: 7,
            background: showAdvanced ? "#6366f120" : "#1c2333",
            border: `1px solid ${showAdvanced ? "#6366f140" : "#2a3245"}`,
            color: showAdvanced ? "#6366f1" : "#8892a4",
            fontSize: 12,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 4,
            whiteSpace: "nowrap",
          }}
        >
          ⚙ More Filters {showAdvanced ? "▲" : "▼"}
        </button>

        {hasActiveFilters && (
          <button
            onClick={clearAll}
            style={{
              padding: "5px 12px",
              borderRadius: 7,
              background: "transparent",
              border: "1px solid rgba(239,68,68,0.3)",
              color: "#ef4444",
              fontSize: 12,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            ✕ Clear All
          </button>
        )}
      </div>

      {/* Advanced filters */}
      {showAdvanced && (
        <div style={{
          marginTop: 12,
          paddingTop: 12,
          borderTop: "1px solid #2a3245",
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "center",
        }}>
          <RangeInput
            label="Bid ($)"
            minVal={filters.bidMin}
            maxVal={filters.bidMax}
            onMinChange={(v) => onChange({ bidMin: v })}
            onMaxChange={(v) => onChange({ bidMax: v })}
            placeholder={["Min", "Max"]}
          />
          <RangeInput
            label="ACOS (%)"
            minVal={filters.acosMin}
            maxVal={filters.acosMax}
            onMinChange={(v) => onChange({ acosMin: v })}
            onMaxChange={(v) => onChange({ acosMax: v })}
            placeholder={["Min", "Max"]}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 10, color: "#555f6e", fontWeight: 500 }}>Min Spend ($)</span>
            <input
              type="number"
              value={filters.spendMin}
              onChange={(e) => onChange({ spendMin: e.target.value })}
              placeholder="0"
              style={{
                background: "#1c2333",
                border: "1px solid #2a3245",
                borderRadius: 6,
                color: "#e2e8f0",
                padding: "5px 8px",
                fontSize: 12,
                width: 80,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function FilterPills({ label, options, labels, value, onChange }: {
  label: string;
  options: string[];
  labels: Record<string, string>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span style={{ fontSize: 10, color: "#555f6e", marginRight: 2, fontWeight: 500 }}>{label}:</span>
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          style={{
            padding: "4px 9px",
            borderRadius: 5,
            fontSize: 11,
            fontWeight: 500,
            cursor: "pointer",
            border: "1px solid",
            borderColor: value === o ? "#6366f1" : "#2a3245",
            background: value === o ? "#6366f120" : "transparent",
            color: value === o ? "#6366f1" : "#8892a4",
            transition: "all 0.1s",
          }}
        >
          {labels[o]}
        </button>
      ))}
    </div>
  );
}

function RangeInput({ label, minVal, maxVal, onMinChange, onMaxChange, placeholder }: {
  label: string;
  minVal: string;
  maxVal: string;
  onMinChange: (v: string) => void;
  onMaxChange: (v: string) => void;
  placeholder: [string, string];
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 10, color: "#555f6e", fontWeight: 500 }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <input
          type="number"
          value={minVal}
          onChange={(e) => onMinChange(e.target.value)}
          placeholder={placeholder[0]}
          style={{
            background: "#1c2333", border: "1px solid #2a3245", borderRadius: 6,
            color: "#e2e8f0", padding: "5px 8px", fontSize: 12, width: 70,
          }}
        />
        <span style={{ color: "#555f6e", fontSize: 11 }}>—</span>
        <input
          type="number"
          value={maxVal}
          onChange={(e) => onMaxChange(e.target.value)}
          placeholder={placeholder[1]}
          style={{
            background: "#1c2333", border: "1px solid #2a3245", borderRadius: 6,
            color: "#e2e8f0", padding: "5px 8px", fontSize: 12, width: 70,
          }}
        />
      </div>
    </div>
  );
}
