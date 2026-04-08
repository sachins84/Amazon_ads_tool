"use client";
import { useEffect } from "react";

interface Props {
  width?: string | number;
  height?: string | number;
  borderRadius?: number;
  style?: React.CSSProperties;
}

export function Skeleton({ width = "100%", height = 16, borderRadius = 5, style }: Props) {
  return (
    <div style={{
      width,
      height,
      borderRadius,
      background: "linear-gradient(90deg, #1c2333 25%, #252e42 50%, #1c2333 75%)",
      backgroundSize: "200% 100%",
      animation: "shimmer 1.5s infinite",
      ...style,
    }} />
  );
}

export function KpiCardSkeleton() {
  return (
    <div style={{
      background: "#161b27",
      border: "1px solid #2a3245",
      borderRadius: 10,
      padding: "18px 20px",
      display: "flex",
      flexDirection: "column",
      gap: 10,
      flex: 1,
    }}>
      <Skeleton width={80} height={10} />
      <Skeleton width={120} height={26} />
      <Skeleton width={90} height={10} />
    </div>
  );
}

export function ChartSkeleton({ height = 260 }: { height?: number }) {
  return (
    <div style={{
      background: "#161b27",
      border: "1px solid #2a3245",
      borderRadius: 10,
      padding: 20,
      height,
      display: "flex",
      flexDirection: "column",
      gap: 12,
    }}>
      <Skeleton width={140} height={13} />
      <Skeleton width={100} height={10} />
      <div style={{ flex: 1, display: "flex", alignItems: "flex-end", gap: 4, paddingTop: 16 }}>
        {Array.from({ length: 20 }).map((_, i) => (
          <Skeleton
            key={i}
            width="100%"
            height={`${30 + Math.sin(i * 0.7) * 25 + 30}%`}
            borderRadius={3}
          />
        ))}
      </div>
    </div>
  );
}

export function TableRowSkeleton({ cols = 8 }: { cols?: number }) {
  return (
    <tr style={{ borderBottom: "1px solid #1a2035" }}>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} style={{ padding: "12px 10px" }}>
          <Skeleton width={i === 0 ? "80%" : "60%"} height={12} />
        </td>
      ))}
    </tr>
  );
}

// inject shimmer keyframe once (useEffect ensures this never runs on the server)
function ShimmerStyle() {
  useEffect(() => {
    if (!document.getElementById("shimmer-style")) {
      const s = document.createElement("style");
      s.id = "shimmer-style";
      s.textContent = `@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`;
      document.head.appendChild(s);
    }
  }, []);
  return null;
}

export { ShimmerStyle };
