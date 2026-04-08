"use client";
import { useState } from "react";

const PRESETS = ["Today", "Yesterday", "Last 7D", "Last 14D", "Last 30D", "This Month", "Last Month"];

interface Props {
  value: string;
  onChange: (v: string) => void;
  compareValue?: string;
  onCompareChange?: (v: string) => void;
  showCompare?: boolean;
}

export default function DateRangePicker({ value, onChange, compareValue, onCompareChange, showCompare }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", position: "relative" }}>
      {/* Main picker */}
      <div style={{ position: "relative" }}>
        <button
          onClick={() => setOpen(!open)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "#1c2333",
            border: "1px solid #2a3245",
            borderRadius: 6,
            color: "#e2e8f0",
            padding: "6px 12px",
            fontSize: 12,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          <CalIcon />
          {value}
          <ChevronIcon />
        </button>
        {open && (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              left: 0,
              background: "#1c2333",
              border: "1px solid #2a3245",
              borderRadius: 8,
              zIndex: 100,
              padding: 8,
              minWidth: 160,
              boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            }}
          >
            {PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => { onChange(p); setOpen(false); }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "7px 12px",
                  background: value === p ? "#6366f120" : "transparent",
                  border: "none",
                  borderRadius: 5,
                  color: value === p ? "#6366f1" : "#e2e8f0",
                  fontSize: 12,
                  cursor: "pointer",
                  fontWeight: value === p ? 600 : 400,
                }}
              >
                {p}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Compare picker */}
      {showCompare && onCompareChange && (
        <select
          value={compareValue}
          onChange={(e) => onCompareChange(e.target.value)}
          style={{
            background: "#1c2333",
            border: "1px solid #2a3245",
            borderRadius: 6,
            color: "#8892a4",
            padding: "6px 10px",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          <option value="none">No comparison</option>
          <option value="prev-period">vs. Previous Period</option>
          <option value="prev-year">vs. Previous Year</option>
        </select>
      )}
    </div>
  );
}

function CalIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8892a4" strokeWidth="2">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#8892a4" strokeWidth="2.5">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
