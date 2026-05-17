import type { MetricWithDelta } from "@/lib/types";
import { fmt } from "@/lib/utils";

type FormatType = "currency" | "percent" | "number" | "multiplier" | "compact";

interface Props {
  label: string;
  metric: MetricWithDelta;
  format: FormatType;
  currency?: string;
  icon?: React.ReactNode;
  small?: boolean;
  loading?: boolean;
}

export default function KpiCard({ label, metric, format, currency = "INR", icon, small, loading }: Props) {
  // Three cases:
  //  1. prev is undefined → legacy API response (backend not redeployed yet)
  //  2. prev is a number > 0 → real comparison possible
  //  3. prev === 0 → no spend/value in prev period (current may still be > 0)
  const hasComparison = metric.prev !== undefined && metric.prev > 0;
  const prevWasZeroButCurrentExists = metric.prev === 0 && metric.value > 0;

  const deltaPositive = metric.positive
    ? metric.delta >= 0
    : metric.delta <= 0;
  const deltaColor = !hasComparison
    ? prevWasZeroButCurrentExists
      ? (metric.positive ? "#22c55e" : "#ef4444")
      : "var(--text-muted)"
    : metric.delta === 0
    ? "var(--text-secondary)"
    : deltaPositive
    ? "#22c55e"
    : "#ef4444";
  const arrow = !hasComparison ? (prevWasZeroButCurrentExists ? "↑" : "—") : metric.delta > 0 ? "↑" : metric.delta < 0 ? "↓" : "—";

  return (
    <div
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
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
        (e.currentTarget as HTMLDivElement).style.borderColor = "var(--border)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = "var(--border)";
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          {label}
        </span>
        {icon && <span style={{ color: "var(--text-secondary)" }}>{icon}</span>}
      </div>
      <div style={{ fontSize: small ? 20 : 24, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.5px" }}>
        {loading ? (
          <div style={{ height: small ? 20 : 24, width: 80, background: "var(--bg-input)", borderRadius: 4, animation: "pulse 1.5s ease-in-out infinite" }} />
        ) : fmt(metric.value, format, currency)}
      </div>
      <div style={{ fontSize: 11, color: deltaColor, display: "flex", alignItems: "center", gap: 3 }}
        title={
          hasComparison ? `Previous: ${fmt(metric.prev!, format, currency)}` :
          prevWasZeroButCurrentExists ? `Previous period had 0 ${label.toLowerCase()} — extend refresh window for older baseline` :
          metric.prev === undefined ? "Comparison data not available (backend may need redeploy)" :
          "No activity in either period"
        }>
        {hasComparison ? (
          <>
            <span style={{ fontWeight: 600 }}>{arrow} {Math.abs(metric.delta).toFixed(1)}%</span>
            <span style={{ color: "var(--text-muted)" }}>vs prev period</span>
          </>
        ) : prevWasZeroButCurrentExists ? (
          <>
            <span style={{ fontWeight: 600 }}>{arrow} new</span>
            <span style={{ color: "var(--text-muted)" }}>vs prev period (was 0)</span>
          </>
        ) : metric.prev === undefined ? (
          <span style={{ color: "var(--text-muted)" }} title="API didn't return a previous-period value. The server needs a redeploy (npm run build + restart) to pick up the new comparison logic.">— no comparison (server needs rebuild)</span>
        ) : (
          <span style={{ color: "var(--text-muted)" }}>— no prior data</span>
        )}
      </div>
    </div>
  );
}
