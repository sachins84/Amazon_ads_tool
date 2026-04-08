"use client";
import type { Target } from "@/lib/types";
import { fmt, acosColor, acosBg } from "@/lib/utils";
import Sparkline from "./Sparkline";

interface Props {
  target: Target | null;
  onClose: () => void;
  onBidChange: (id: string, bid: number) => void;
}

export default function TargetDetailDrawer({ target, onClose, onBidChange }: Props) {
  if (!target) return null;

  const metrics = [
    { label: "Spend",   val: fmt(target.spend, "currency") },
    { label: "Revenue", val: fmt(target.revenue, "currency") },
    { label: "ACOS",    val: fmt(target.acos, "percent"),    color: acosColor(target.acos) },
    { label: "ROAS",    val: fmt(target.roas, "multiplier") },
    { label: "Orders",  val: fmt(target.orders, "number") },
    { label: "Clicks",  val: fmt(target.clicks, "number") },
    { label: "Impr.",   val: fmt(target.impressions, "compact") },
    { label: "CTR",     val: fmt(target.ctr, "percent") },
    { label: "CVR",     val: fmt(target.cvr, "percent") },
    { label: "CPC",     val: fmt(target.cpc, "currency") },
  ];

  const typeLabel: Record<Target["type"], string> = {
    KEYWORD: "Keyword", ASIN: "ASIN", CATEGORY: "Category", AUTO: "Auto",
  };
  const matchColors: Record<Target["matchType"], string> = {
    EXACT: "#6366f1", PHRASE: "#8b5cf6", BROAD: "#a78bfa", AUTO: "#555f6e",
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.5)",
          zIndex: 198,
        }}
      />
      {/* Drawer */}
      <div style={{
        position: "fixed",
        top: 0, right: 0,
        width: 340,
        height: "100vh",
        background: "#161b27",
        borderLeft: "1px solid #2a3245",
        zIndex: 199,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          padding: "18px 20px",
          borderBottom: "1px solid #2a3245",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}>
          <div>
            <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
              <span style={{
                fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 4,
                background: "rgba(99,102,241,0.15)", color: "#6366f1",
              }}>
                {typeLabel[target.type]}
              </span>
              {target.matchType !== "AUTO" && (
                <span style={{
                  fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 4,
                  background: `${matchColors[target.matchType]}20`,
                  color: matchColors[target.matchType],
                }}>
                  {target.matchType}
                </span>
              )}
              <span style={{
                fontSize: 10, fontWeight: 500, padding: "2px 7px", borderRadius: 10,
                background: target.status === "ENABLED" ? "rgba(34,197,94,0.12)" : "rgba(245,158,11,0.12)",
                color: target.status === "ENABLED" ? "#22c55e" : "#f59e0b",
              }}>
                {target.status}
              </span>
            </div>
            <h3 style={{
              fontSize: 14, fontWeight: 700, color: "#e2e8f0",
              wordBreak: "break-all", lineHeight: 1.4,
            }}>
              {target.value}
            </h3>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent", border: "none",
              color: "#555f6e", cursor: "pointer", fontSize: 18, lineHeight: 1,
              padding: "2px 4px",
            }}
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
          {/* Campaign / Ad Group */}
          <div style={{
            background: "#1c2333", borderRadius: 8, padding: "12px 14px", marginBottom: 16,
          }}>
            <div style={{ marginBottom: 8 }}>
              <span style={{ fontSize: 10, color: "#555f6e", display: "block", marginBottom: 2 }}>Campaign</span>
              <span style={{ fontSize: 12, color: "#e2e8f0" }}>{target.campaignName}</span>
            </div>
            <div>
              <span style={{ fontSize: 10, color: "#555f6e", display: "block", marginBottom: 2 }}>Ad Group</span>
              <span style={{ fontSize: 12, color: "#e2e8f0" }}>{target.adGroupName}</span>
            </div>
          </div>

          {/* Bid */}
          <div style={{
            background: "#1c2333", borderRadius: 8, padding: "12px 14px", marginBottom: 16,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <span style={{ fontSize: 10, color: "#555f6e", display: "block", marginBottom: 2 }}>Current Bid</span>
                <span style={{ fontSize: 20, fontWeight: 700, color: "#e2e8f0" }}>
                  ₹{target.bid.toFixed(2)}
                </span>
              </div>
              <div style={{ textAlign: "right" }}>
                <span style={{ fontSize: 10, color: "#555f6e", display: "block", marginBottom: 2 }}>Suggested Bid</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: "#6366f1" }}>
                  ₹{target.suggestedBid.toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          {/* Metrics */}
          <div style={{ marginBottom: 16 }}>
            <h4 style={{ fontSize: 11, color: "#555f6e", marginBottom: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Performance (Last 30 Days)
            </h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {metrics.map((m) => (
                <div key={m.label} style={{
                  background: "#1c2333", borderRadius: 6, padding: "10px 12px",
                }}>
                  <span style={{ fontSize: 10, color: "#555f6e", display: "block", marginBottom: 3 }}>{m.label}</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: m.color || "#e2e8f0" }}>{m.val}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Sparkline */}
          <div style={{ marginBottom: 16 }}>
            <h4 style={{ fontSize: 11, color: "#555f6e", marginBottom: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              7-Day ACOS Trend
            </h4>
            <div style={{ background: "#1c2333", borderRadius: 8, padding: "12px 14px" }}>
              <Sparkline data={target.trend7d} color="#f59e0b" width={280} height={50} />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                <span style={{ fontSize: 10, color: "#555f6e" }}>7 days ago</span>
                <span style={{ fontSize: 10, color: "#555f6e" }}>Today</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div style={{
          padding: "14px 20px",
          borderTop: "1px solid #2a3245",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
        }}>
          <button style={{
            padding: "8px",
            borderRadius: 6,
            background: "#6366f120",
            border: "1px solid #6366f140",
            color: "#6366f1",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}>
            Edit Bid
          </button>
          <button style={{
            padding: "8px",
            borderRadius: 6,
            background: "rgba(239,68,68,0.1)",
            border: "1px solid rgba(239,68,68,0.2)",
            color: "#ef4444",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}>
            Add Negative
          </button>
          <button style={{
            padding: "8px",
            borderRadius: 6,
            background: "#1c2333",
            border: "1px solid #2a3245",
            color: "#8892a4",
            fontSize: 12,
            cursor: "pointer",
          }}>
            {target.status === "ENABLED" ? "Pause" : "Enable"}
          </button>
          <button style={{
            padding: "8px",
            borderRadius: 6,
            background: "#1c2333",
            border: "1px solid #2a3245",
            color: "#8892a4",
            fontSize: 12,
            cursor: "pointer",
          }}>
            Archive
          </button>
        </div>
      </div>
    </>
  );
}
