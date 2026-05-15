"use client";
import { useEffect, useState, useCallback } from "react";
import TopNav from "@/components/shared/TopNav";
import { useAccount } from "@/lib/account-context";
import type { Objective, Metric } from "@/lib/rules/types";

const METRICS: Metric[] = ["SPEND", "SALES", "ORDERS", "ROAS", "ACOS", "CTR", "CPC", "CVR"];

export default function ObjectivesPage() {
  const { activeAccount } = useAccount();
  const accountId = activeAccount?.id ?? "";
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const qs = accountId ? `?accountId=${accountId}` : "";
    const res = await fetch(`/api/objectives${qs}`);
    const j = await res.json();
    setObjectives(j.objectives ?? []);
  }, [accountId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ minHeight: "100vh", background: "#0d1117" }}>
      <TopNav />
      <main style={{ padding: "24px 28px", maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: "#e2e8f0" }}>Objectives</h1>
            <p style={{ fontSize: 12, color: "#8892a4", marginTop: 2 }}>
              {accountId ? `For ${activeAccount?.name}` : "All accounts"} · {objectives.length} objective{objectives.length === 1 ? "" : "s"}
            </p>
          </div>
          <button onClick={() => setCreating(true)} style={btnPrimary}>+ New objective</button>
        </div>

        {creating && (
          <NewObjective
            accountId={accountId || null}
            onSave={async (input) => {
              await fetch("/api/objectives", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
              setCreating(false); load();
            }}
            onCancel={() => setCreating(false)}
          />
        )}

        {objectives.length === 0 ? (
          <div style={{ background: "#161b27", border: "1px solid #2a3245", padding: 32, borderRadius: 10, textAlign: "center", color: "#8892a4" }}>
            No objectives yet. Define one like &ldquo;ROAS ≥ 2.0 on BeBodywise&rdquo; or &ldquo;ACOS ≤ 25%&rdquo; to drive rule prioritization.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {objectives.map((o) => (
              <div key={o.id} style={{ background: "#161b27", border: "1px solid #2a3245", borderRadius: 10, padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0" }}>{o.name}</div>
                    <div style={{ fontSize: 12, color: "#a5b4fc", marginTop: 4, fontFamily: "ui-monospace, monospace" }}>
                      {o.targetMetric} {humanCmp(o.comparator)} {o.targetValue}
                    </div>
                  </div>
                  <button onClick={async () => {
                    if (!confirm(`Delete "${o.name}"?`)) return;
                    await fetch(`/api/objectives/${o.id}`, { method: "DELETE" });
                    load();
                  }} style={{ ...btnSecondary, color: "#ef4444" }}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function NewObjective({ accountId, onSave, onCancel }: {
  accountId: string | null;
  onSave: (input: Omit<Objective, "id" | "createdAt" | "updatedAt">) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [metric, setMetric] = useState<Metric>("ROAS");
  const [comparator, setComparator] = useState<"GTE" | "LTE" | "EQ">("GTE");
  const [value, setValue] = useState("2");

  return (
    <div style={{ background: "#161b27", border: "1px solid #2a3245", borderRadius: 10, padding: 16, marginBottom: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 8, alignItems: "end" }}>
        <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Scale BeBodywise to ROAS ≥ 2" style={inputStyle} /></Field>
        <Field label="Metric">
          <select value={metric} onChange={(e) => setMetric(e.target.value as Metric)} style={inputStyle}>
            {METRICS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Comparator">
          <select value={comparator} onChange={(e) => setComparator(e.target.value as "GTE" | "LTE" | "EQ")} style={inputStyle}>
            <option value="GTE">≥</option><option value="LTE">≤</option><option value="EQ">=</option>
          </select>
        </Field>
        <Field label="Value"><input value={value} onChange={(e) => setValue(e.target.value)} style={inputStyle} type="number" step="0.01" /></Field>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <button onClick={onCancel} style={btnSecondary}>Cancel</button>
        <button onClick={() => {
          if (!name.trim()) { alert("Name required"); return; }
          onSave({ name: name.trim(), accountId, scopeFilter: null, targetMetric: metric, comparator, targetValue: parseFloat(value), enabled: true });
        }} style={btnPrimary}>Save</button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "#8892a4", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}
function humanCmp(c: "GTE" | "LTE" | "EQ"): string { return c === "GTE" ? "≥" : c === "LTE" ? "≤" : "="; }

const inputStyle: React.CSSProperties = {
  background: "#0d1117", border: "1px solid #2a3245", borderRadius: 6, color: "#e2e8f0",
  padding: "6px 10px", fontSize: 12, outline: "none", width: "100%",
};
const btnSecondary: React.CSSProperties = {
  padding: "6px 12px", borderRadius: 6, background: "#1c2333",
  border: "1px solid #2a3245", color: "#8892a4", fontSize: 12, cursor: "pointer",
};
const btnPrimary: React.CSSProperties = {
  padding: "6px 14px", borderRadius: 6,
  background: "linear-gradient(135deg,#6366f1,#8b5cf6)",
  border: "1px solid transparent",
  color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer",
};
