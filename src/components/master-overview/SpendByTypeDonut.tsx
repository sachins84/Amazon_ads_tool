"use client";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";

interface Props {
  data: { name: string; value: number; color: string }[];
}

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "#1c2333",
      border: "1px solid #2a3245",
      borderRadius: 8,
      padding: "10px 14px",
      fontSize: 12,
    }}>
      <p style={{ color: payload[0].payload.color, fontWeight: 600 }}>{payload[0].name}</p>
      <p style={{ color: "#e2e8f0" }}>₹{Math.round(payload[0].value).toLocaleString()}</p>
    </div>
  );
};

export default function SpendByTypeDonut({ data }: Props) {
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div style={{
      background: "#161b27",
      border: "1px solid #2a3245",
      borderRadius: 10,
      padding: "20px",
    }}>
      <div style={{ marginBottom: 8 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>Spend by Campaign Type</h3>
        <p style={{ fontSize: 11, color: "#8892a4", marginTop: 2 }}>SP · SB · SD breakdown</p>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <ResponsiveContainer width={180} height={180}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={52}
              outerRadius={78}
              paddingAngle={3}
              dataKey="value"
            >
              {data.map((entry, i) => (
                <Cell key={i} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
          {data.map((d) => (
            <div key={d.name} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: d.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: "#8892a4" }}>{d.name}</span>
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0" }}>
                  {Math.round((d.value / total) * 100)}%
                </span>
              </div>
              <div style={{ background: "#1c2333", borderRadius: 3, height: 4, overflow: "hidden" }}>
                <div style={{
                  background: d.color,
                  height: "100%",
                  width: `${(d.value / total) * 100}%`,
                  borderRadius: 3,
                }} />
              </div>
              <span style={{ fontSize: 11, color: "#555f6e" }}>₹{Math.round(d.value).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
