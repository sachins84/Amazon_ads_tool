"use client";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from "recharts";
import type { CampaignRow } from "@/lib/types";

interface Props {
  campaigns: CampaignRow[];
}

const COLORS = ["#6366f1", "#7c3aed", "#8b5cf6", "#a78bfa", "#c4b5fd", "#6366f1", "#7c3aed", "#8b5cf6", "#a78bfa", "#c4b5fd"];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "#1c2333",
      border: "1px solid #2a3245",
      borderRadius: 8,
      padding: "10px 14px",
      fontSize: 12,
      maxWidth: 200,
    }}>
      <p style={{ color: "#8892a4", marginBottom: 4, fontSize: 11 }}>{label}</p>
      <p style={{ color: "#6366f1" }}>Spend: <strong>₹{Math.round(payload[0]?.value ?? 0).toLocaleString()}</strong></p>
    </div>
  );
};

export default function TopCampaignsChart({ campaigns }: Props) {
  const top10 = [...campaigns]
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 8)
    .map((c) => ({
      name: c.name.length > 22 ? c.name.slice(0, 22) + "…" : c.name,
      spend: c.spend,
    }));

  return (
    <div style={{
      background: "#161b27",
      border: "1px solid #2a3245",
      borderRadius: 10,
      padding: "20px",
    }}>
      <div style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>Top Campaigns by Spend</h3>
        <p style={{ fontSize: 11, color: "#8892a4", marginTop: 2 }}>Top 8 campaigns this period</p>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={top10} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e2a3a" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fontSize: 10, fill: "#555f6e" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => v >= 100000 ? `₹${(v / 100000).toFixed(1)}L` : `₹${(v / 1000).toFixed(0)}K`}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fontSize: 10, fill: "#8892a4" }}
            axisLine={false}
            tickLine={false}
            width={140}
          />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey="spend" radius={[0, 4, 4, 0]} maxBarSize={18}>
            {top10.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
