"use client";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import type { TimeSeriesPoint } from "@/lib/types";

interface Props {
  data: TimeSeriesPoint[];
  targetAcos?: number;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "#1c2333",
      border: "1px solid #2a3245",
      borderRadius: 8,
      padding: "10px 14px",
      fontSize: 12,
    }}>
      <p style={{ color: "#8892a4", marginBottom: 4 }}>{label}</p>
      <p style={{ color: "#f59e0b" }}>ACOS: <strong>{payload[0]?.value}%</strong></p>
    </div>
  );
};

export default function AcosTrendChart({ data, targetAcos = 20 }: Props) {
  return (
    <div style={{
      background: "#161b27",
      border: "1px solid #2a3245",
      borderRadius: 10,
      padding: "20px",
    }}>
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h3 style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>ACOS Trend</h3>
          <p style={{ fontSize: 11, color: "#8892a4", marginTop: 2 }}>Daily ACOS with target threshold</p>
        </div>
        <div style={{
          fontSize: 11,
          color: "#f59e0b",
          background: "rgba(245,158,11,0.12)",
          border: "1px solid rgba(245,158,11,0.2)",
          borderRadius: 4,
          padding: "2px 8px",
        }}>
          Target: {targetAcos}%
        </div>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="acosGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e2a3a" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: "#555f6e" }}
            axisLine={false}
            tickLine={false}
            interval={4}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "#555f6e" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${v}%`}
            width={36}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine
            y={targetAcos}
            stroke="#ef4444"
            strokeDasharray="4 3"
            strokeWidth={1.5}
            label={{ value: `Target ${targetAcos}%`, fill: "#ef4444", fontSize: 10, position: "right" }}
          />
          <Area
            type="monotone"
            dataKey="acos"
            stroke="#f59e0b"
            strokeWidth={2}
            fill="url(#acosGrad)"
            dot={false}
            activeDot={{ r: 4, fill: "#f59e0b" }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
