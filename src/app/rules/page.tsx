"use client";
import { useEffect, useState, useCallback } from "react";
import TopNav from "@/components/shared/TopNav";
import { useAccount } from "@/lib/account-context";
import type {
  Rule, AppliesTo, Metric, Comparator, Action, ConditionTree, Clause, Program,
} from "@/lib/rules/types";

const METRICS: Metric[] = ["SPEND", "SALES", "ORDERS", "ROAS", "ACOS", "CTR", "CPC", "CVR", "IMPRESSIONS", "CLICKS"];
const COMPS: Comparator[] = ["GT", "GTE", "LT", "LTE", "EQ", "NEQ"];
const APPLIES: AppliesTo[] = ["CAMPAIGN", "AD_GROUP", "KEYWORD", "PRODUCT_TARGET"];
const PROGRAMS: Program[] = ["SP", "SB", "SD"];
const ACTION_TYPES: Action["type"][] = ["PAUSE", "ENABLE", "SET_BID", "BID_PCT", "SET_BUDGET", "BUDGET_PCT", "ADD_NEGATIVE"];

export default function RulesPage() {
  const { activeAccount } = useAccount();
  const accountId = activeAccount?.id ?? "";
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const qs = accountId ? `?accountId=${accountId}` : "";
    const res = await fetch(`/api/rules${qs}`);
    const j = await res.json();
    setRules(j.rules ?? []);
    setLoading(false);
  }, [accountId]);

  useEffect(() => { load(); }, [load]);

  const runNow = useCallback(async () => {
    if (!accountId) { alert("Pick a brand first"); return; }
    setRunning(true); setRunResult(null);
    try {
      const res = await fetch(`/api/suggestions?accountId=${accountId}&dateRange=Last+7D`, { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Run failed");
      setRunResult(`Ran ${j.rulesEvaluated} rule(s) → ${j.suggestionsCreated} suggestion(s) created.`);
    } catch (e) {
      setRunResult(`Error: ${String(e)}`);
    } finally {
      setRunning(false);
    }
  }, [accountId]);

  const toggleRule = async (rule: Rule) => {
    await fetch(`/api/rules/${rule.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !rule.enabled }) });
    load();
  };
  const deleteRule = async (rule: Rule) => {
    if (!confirm(`Delete rule "${rule.name}"?`)) return;
    await fetch(`/api/rules/${rule.id}`, { method: "DELETE" });
    load();
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0d1117" }}>
      <TopNav />
      <main style={{ padding: "24px 28px", maxWidth: 1400, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: "#e2e8f0" }}>Rules</h1>
            <p style={{ fontSize: 12, color: "#8892a4", marginTop: 2 }}>
              {accountId ? `For ${activeAccount?.name}` : "All accounts (pick a brand for run)"} · {rules.length} rule{rules.length === 1 ? "" : "s"}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={runNow} disabled={!accountId || running} style={btnPrimary(running || !accountId)}>
              {running ? "Running…" : "▶ Run now"}
            </button>
            <button onClick={() => setCreating(true)} style={btnSecondary}>+ New rule</button>
          </div>
        </div>

        {runResult && (
          <div style={{ background: "#161b27", border: "1px solid #2a3245", padding: 12, borderRadius: 8, fontSize: 12, color: "#a5b4fc", marginBottom: 12 }}>
            {runResult}
          </div>
        )}

        {creating && (
          <RuleEditor
            accountId={accountId || null}
            onSave={async (input) => {
              await fetch("/api/rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
              setCreating(false);
              load();
            }}
            onCancel={() => setCreating(false)}
          />
        )}

        {loading ? (
          <div style={{ color: "#8892a4", padding: 16 }}>Loading…</div>
        ) : rules.length === 0 ? (
          <div style={{ background: "#161b27", border: "1px solid #2a3245", padding: 32, borderRadius: 10, textAlign: "center", color: "#8892a4" }}>
            No rules yet. Click <strong>+ New rule</strong> to create one. Examples: <em>“Pause keywords with &gt;₹500 spend and 0 orders in last 14 days,”</em> or <em>“Lower bid 20% on keywords with ACOS &gt; 50%.”</em>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {rules.map((r) => <RuleCard key={r.id} rule={r} onToggle={() => toggleRule(r)} onDelete={() => deleteRule(r)} />)}
          </div>
        )}
      </main>
    </div>
  );
}

function RuleCard({ rule, onToggle, onDelete }: { rule: Rule; onToggle: () => void; onDelete: () => void }) {
  return (
    <div style={{ background: "#161b27", border: "1px solid #2a3245", borderRadius: 10, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0" }}>{rule.name}</div>
          <div style={{ fontSize: 11, color: "#8892a4", marginTop: 2 }}>
            applies to <strong>{rule.appliesTo}</strong> · {rule.programs?.join(", ") ?? "all programs"} · mode <strong>{rule.mode}</strong> · last run {rule.lastRunAt ?? "never"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onToggle} style={{ ...btnSecondary, background: rule.enabled ? "#1c2333" : "rgba(34,197,94,0.15)", color: rule.enabled ? "#8892a4" : "#86efac" }}>
            {rule.enabled ? "Disable" : "Enable"}
          </button>
          <button onClick={onDelete} style={{ ...btnSecondary, color: "#ef4444" }}>Delete</button>
        </div>
      </div>
      <div style={{ marginTop: 8, fontSize: 12, color: "#a5b4fc", fontFamily: "ui-monospace, monospace" }}>
        IF {describeConditions(rule.conditions)} THEN {rule.actions.map(describeAction).join("; ")}
      </div>
    </div>
  );
}

function describeConditions(node: ConditionTree | Clause): string {
  if ("metric" in node) return `${node.metric} ${humanOp(node.op)} ${node.value}`;
  const parts = node.clauses.map(describeConditions);
  return parts.length > 1 ? `(${parts.join(` ${node.op} `)})` : parts[0] ?? "";
}
function describeAction(a: Action): string {
  switch (a.type) {
    case "PAUSE":        return "PAUSE";
    case "ENABLE":       return "ENABLE";
    case "SET_BID":      return `SET BID = ${a.value}`;
    case "BID_PCT":      return `BID ${a.value >= 0 ? "↑" : "↓"}${Math.abs(a.value)}%`;
    case "SET_BUDGET":   return `SET BUDGET = ${a.value}`;
    case "BUDGET_PCT":   return `BUDGET ${a.value >= 0 ? "↑" : "↓"}${Math.abs(a.value)}%`;
    case "ADD_NEGATIVE": return "ADD NEGATIVE";
  }
}
function humanOp(op: Comparator): string {
  return { GT: ">", GTE: "≥", LT: "<", LTE: "≤", EQ: "=", NEQ: "≠" }[op];
}

function RuleEditor({ accountId, onSave, onCancel }: {
  accountId: string | null;
  onSave: (input: Omit<Rule, "id" | "createdAt" | "updatedAt" | "lastRunAt">) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [appliesTo, setAppliesTo] = useState<AppliesTo>("CAMPAIGN");
  const [programs, setPrograms] = useState<Program[]>(["SP"]);
  const [conditions, setConditions] = useState<Clause[]>([{ metric: "SPEND", op: "GT", value: 500 }]);
  const [conditionOp, setConditionOp] = useState<"AND" | "OR">("AND");
  const [actions, setActions] = useState<Action[]>([{ type: "PAUSE" }]);
  const [mode, setMode] = useState<"SUGGEST" | "AUTO_APPLY">("SUGGEST");

  const addClause   = () => setConditions((c) => [...c, { metric: "ORDERS", op: "EQ", value: 0 }]);
  const removeClause = (i: number) => setConditions((c) => c.filter((_, idx) => idx !== i));
  const updateClause = (i: number, patch: Partial<Clause>) =>
    setConditions((c) => c.map((cl, idx) => idx === i ? { ...cl, ...patch } : cl));

  const addAction = () => setActions((a) => [...a, { type: "PAUSE" }]);
  const removeAction = (i: number) => setActions((a) => a.filter((_, idx) => idx !== i));
  const updateAction = (i: number, patch: Partial<Action>) =>
    setActions((a) => a.map((act, idx) => idx === i ? { ...(act as object), ...patch } as Action : act));

  const toggleProgram = (p: Program) =>
    setPrograms((cur) => cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]);

  const save = () => {
    if (!name.trim()) { alert("Rule name required"); return; }
    onSave({
      name: name.trim(),
      accountId,
      objectiveId: null,
      appliesTo,
      programs: programs.length ? programs : null,
      conditions: { op: conditionOp, clauses: conditions },
      actions,
      mode,
      enabled: true,
    });
  };

  return (
    <div style={{ background: "#161b27", border: "1px solid #2a3245", borderRadius: 10, padding: 20, marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0", marginBottom: 12 }}>New rule</div>

      <Field label="Name">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pause SP keywords wasting spend" style={inputStyle} />
      </Field>

      <Field label="Applies to">
        <select value={appliesTo} onChange={(e) => setAppliesTo(e.target.value as AppliesTo)} style={inputStyle}>
          {APPLIES.map((a) => <option key={a} value={a}>{a.replace("_", " ")}</option>)}
        </select>
      </Field>

      <Field label="Programs">
        <div style={{ display: "flex", gap: 8 }}>
          {PROGRAMS.map((p) => (
            <button key={p} onClick={() => toggleProgram(p)} style={{
              ...btnSecondary,
              background: programs.includes(p) ? "rgba(99,102,241,0.15)" : "#1c2333",
              color:      programs.includes(p) ? "#a5b4fc" : "#8892a4",
            }}>{p}</button>
          ))}
        </div>
      </Field>

      <Field label="IF">
        <select value={conditionOp} onChange={(e) => setConditionOp(e.target.value as "AND" | "OR")} style={{ ...inputStyle, width: 80, marginBottom: 8 }}>
          <option>AND</option><option>OR</option>
        </select>
        {conditions.map((c, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
            <select value={c.metric} onChange={(e) => updateClause(i, { metric: e.target.value as Metric })} style={{ ...inputStyle, width: 140 }}>
              {METRICS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <select value={c.op} onChange={(e) => updateClause(i, { op: e.target.value as Comparator })} style={{ ...inputStyle, width: 80 }}>
              {COMPS.map((o) => <option key={o} value={o}>{humanOp(o)}</option>)}
            </select>
            <input type="number" step="0.01" value={c.value} onChange={(e) => updateClause(i, { value: parseFloat(e.target.value) || 0 })} style={{ ...inputStyle, width: 120 }} />
            <button onClick={() => removeClause(i)} style={{ ...btnSecondary, color: "#ef4444" }}>×</button>
          </div>
        ))}
        <button onClick={addClause} style={{ ...btnSecondary, marginTop: 4 }}>+ condition</button>
      </Field>

      <Field label="THEN">
        {actions.map((a, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
            <select
              value={a.type}
              onChange={(e) => {
                const t = e.target.value as Action["type"];
                // Build minimum-valid action with sensible defaults
                if (t === "PAUSE" || t === "ENABLE" || t === "ADD_NEGATIVE") updateAction(i, { type: t });
                else if (t === "SET_BID") updateAction(i, { type: t, value: 1.0 } as Action);
                else if (t === "BID_PCT") updateAction(i, { type: t, value: -20 } as Action);
                else if (t === "SET_BUDGET") updateAction(i, { type: t, value: 100 } as Action);
                else if (t === "BUDGET_PCT") updateAction(i, { type: t, value: 10 } as Action);
              }}
              style={{ ...inputStyle, width: 180 }}>
              {ACTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {(a.type === "SET_BID" || a.type === "BID_PCT" || a.type === "SET_BUDGET" || a.type === "BUDGET_PCT") && (
              <input type="number" step="0.01" value={(a as { value: number }).value} onChange={(e) => updateAction(i, { value: parseFloat(e.target.value) || 0 } as Partial<Action>)} style={{ ...inputStyle, width: 120 }} />
            )}
            <button onClick={() => removeAction(i)} style={{ ...btnSecondary, color: "#ef4444" }}>×</button>
          </div>
        ))}
        <button onClick={addAction} style={{ ...btnSecondary, marginTop: 4 }}>+ action</button>
      </Field>

      <Field label="Mode">
        <select value={mode} onChange={(e) => setMode(e.target.value as "SUGGEST" | "AUTO_APPLY")} style={inputStyle}>
          <option value="SUGGEST">SUGGEST (review first)</option>
          <option value="AUTO_APPLY">AUTO_APPLY (push to Amazon)</option>
        </select>
      </Field>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <button onClick={onCancel} style={btnSecondary}>Cancel</button>
        <button onClick={save} style={btnPrimary(false)}>Save rule</button>
      </div>
    </div>
  );
}

// ─── style helpers ───────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: "#8892a4", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "#0d1117", border: "1px solid #2a3245", borderRadius: 6,
  color: "#e2e8f0", padding: "6px 10px", fontSize: 12, outline: "none",
};
const btnSecondary: React.CSSProperties = {
  padding: "6px 12px", borderRadius: 6, background: "#1c2333",
  border: "1px solid #2a3245", color: "#8892a4", fontSize: 12, cursor: "pointer",
};
function btnPrimary(disabled: boolean): React.CSSProperties {
  return {
    padding: "6px 14px", borderRadius: 6,
    background: disabled ? "#1c2333" : "linear-gradient(135deg,#6366f1,#8b5cf6)",
    border: "1px solid",
    borderColor: disabled ? "#2a3245" : "transparent",
    color: disabled ? "#555f6e" : "#fff",
    fontSize: 12, fontWeight: 600,
    cursor: disabled ? "default" : "pointer",
  };
}
