import type { MetricWithDelta } from "@/lib/types";
import { fmt } from "@/lib/utils";

type FormatType = "currency" | "percent" | "number" | "multiplier" | "compact";

interface Props {
  label: string;
  metric: MetricWithDelta;
  format: FormatType;
  icon?: React.ReactNode;
  small?: boolean;
  loading?: boolean;
}

export default function KpiCard({ label, metric, format, icon, small, loading }: Props) {
  const deltaPositive = metric.positive
    ? metric.delta >= 0
    : metric.delta <= 0;
  const deltaColor = metric.delta === 0
    ? "#8892a4"
    : deltaPositive
    ? "#22c55e"
    : "#ef4444";
  const arrow = metric.delta > 0 ? "↑" : metric.delta < 0 ? "↓" : "—";

  return (
    <div
      style={{
        background: "#161b27",
        border: "1px solid #2a3245",
        borderRadius: 10,
        padding: small ? "14px 16px" : "18px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        flex: 1,
        minWidth: 0,
        transition: "border-color 0.15s",
        cursor: "default",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = "#3a4560";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = "#2a3245";
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "#8892a4", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          {label}
        </span>
        {icon && <span style={{ color: "#8892a4" }}>{icon}</span>}
      </div>
      <div style={{ fontSize: small ? 20 : 24, fontWeight: 700, color: "#e2e8f0", letterSpacing: "-0.5px" }}>
        {loading ? (
          <div style={{ height: small ? 20 : 24, width: 80, background: "#1c2333", borderRadius: 4, animation: "pulse 1.5s ease-in-out infinite" }} />
        ) : fmt(metric.value, format)}
      </div>
      <div style={{ fontSize: 11, color: deltaColor, display: "flex", alignItems: "center", gap: 3 }}>
        <span style={{ fontWeight: 600 }}>{arrow} {Math.abs(metric.delta).toFixed(1)}%</span>
        <span style={{ color: "#555f6e" }}>vs prev period</span>
      </div>
    </div>
  );
}
