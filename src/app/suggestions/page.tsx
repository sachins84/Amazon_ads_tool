"use client";
import { useEffect, useState, useCallback } from "react";
import TopNav from "@/components/shared/TopNav";
import { fmt } from "@/lib/utils";
import { useAccount } from "@/lib/account-context";
import type { Suggestion, SuggestionStatus } from "@/lib/rules/types";

const STATUSES: (SuggestionStatus | "ANY")[] = ["PENDING", "APPROVED", "APPLIED", "DISMISSED", "FAILED", "ANY"];

export default function SuggestionsPage() {
  const { activeAccount } = useAccount();
  const accountId = activeAccount?.id ?? "";
  const currency = activeAccount?.adsMarketplace === "IN" ? "INR" : "USD";

  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [status, setStatus] = useState<SuggestionStatus | "ANY">("PENDING");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (accountId) qs.set("accountId", accountId);
    qs.set("status", status);
    const res = await fetch(`/api/suggestions?${qs}`);
    const j = await res.json();
    setSuggestions(j.suggestions ?? []);
    setLoading(false);
  }, [accountId, status]);

  useEffect(() => { load(); }, [load]);

  const runRulesNow = async () => {
    if (!accountId) { alert("Pick a brand first"); return; }
    setRunning(true);
    try {
      const res = await fetch(`/api/suggestions?accountId=${accountId}&dateRange=Last+7D`, { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      alert(`Created ${j.suggestionsCreated} new suggestion(s) across ${j.rulesEvaluated} rule(s).`);
      load();
    } catch (e) {
      alert(`Run failed: ${String(e)}`);
    } finally {
      setRunning(false);
    }
  };

  const updateStatus = async (id: string, newStatus: SuggestionStatus) => {
    await fetch(`/api/suggestions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    load();
  };

  const bulkApprove = async () => {
    if (!confirm(`Approve all ${suggestions.length} suggestions? Apply-to-Amazon is Phase 3 — this only marks them as APPROVED.`)) return;
    setBulkBusy(true);
    await Promise.all(suggestions.map((s) =>
      fetch(`/api/suggestions/${s.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "APPROVED" }) })
    ));
    setBulkBusy(false);
    load();
  };

  // Group by rule
  const groups = suggestions.reduce<Record<string, Suggestion[]>>((acc, s) => {
    (acc[s.ruleId] ??= []).push(s);
    return acc;
  }, {});

  // Compute totals across pending suggestions
  const totalSpendImpact = suggestions
    .filter((s) => s.expectedImpact?.savedSpend)
    .reduce((a, s) => a + (s.expectedImpact?.savedSpend ?? 0), 0);

  return (
    <div style={{ minHeight: "100vh", background: "#0d1117" }}>
      <TopNav />
      <main style={{ padding: "24px 28px", maxWidth: 1400, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: "#e2e8f0" }}>Suggestions</h1>
            <p style={{ fontSize: 12, color: "#8892a4", marginTop: 2 }}>
              {accountId ? `${activeAccount?.name} · ` : ""}{suggestions.length} {status === "ANY" ? "" : status.toLowerCase()} suggestion{suggestions.length === 1 ? "" : "s"}
              {totalSpendImpact > 0 && status === "PENDING" && ` · est. ${fmt(totalSpendImpact, "currency", currency)} potential savings`}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select value={status} onChange={(e) => setStatus(e.target.value as SuggestionStatus | "ANY")} style={inputStyle}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button onClick={runRulesNow} disabled={!accountId || running} style={btnPrimary(!accountId || running)}>
              {running ? "Running…" : "▶ Run rules now"}
            </button>
            {status === "PENDING" && suggestions.length > 0 && (
              <button onClick={bulkApprove} disabled={bulkBusy} style={btnSecondary}>
                Approve all
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div style={{ color: "#8892a4", padding: 16 }}>Loading…</div>
        ) : suggestions.length === 0 ? (
          <Empty status={status} hasAccount={!!accountId} />
        ) : (
          Object.entries(groups).map(([ruleId, items]) => (
            <RuleGroup key={ruleId} ruleId={ruleId} items={items} currency={currency} onUpdate={updateStatus} />
          ))
        )}
      </main>
    </div>
  );
}

function RuleGroup({ ruleId, items, currency, onUpdate }: {
  ruleId: string;
  items: Suggestion[];
  currency: string;
  onUpdate: (id: string, s: SuggestionStatus) => void;
}) {
  const totalSpend = items.reduce((s, i) => s + (i.expectedImpact?.savedSpend ?? 0), 0);
  return (
    <div style={{ background: "#161b27", border: "1px solid #2a3245", borderRadius: 10, padding: 16, marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: "#8892a4", marginBottom: 10 }}>
        Rule <code style={{ color: "#a5b4fc" }}>{ruleId.slice(0, 8)}</code> · {items.length} suggestion{items.length === 1 ? "" : "s"}
        {totalSpend > 0 && ` · est. ${fmt(totalSpend, "currency", currency)} savings`}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((s) => <SuggestionRow key={s.id} s={s} currency={currency} onUpdate={onUpdate} />)}
      </div>
    </div>
  );
}

function SuggestionRow({ s, currency, onUpdate }: { s: Suggestion; currency: string; onUpdate: (id: string, status: SuggestionStatus) => void }) {
  const statusColor = s.status === "PENDING" ? "#a5b4fc"
    : s.status === "APPROVED" ? "#fde68a"
    : s.status === "APPLIED" ? "#86efac"
    : s.status === "DISMISSED" ? "#555f6e"
    : "#ef4444";
  return (
    <div style={{ borderTop: "1px solid #1c2333", paddingTop: 10, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ ...pill("#2a3245", "#a5b4fc"), fontSize: 10 }}>{s.targetType}</span>
          {s.program && <span style={{ ...pill("rgba(99,102,241,0.15)", "#a5b4fc"), fontSize: 10 }}>{s.program}</span>}
          <span style={{ ...pill("rgba(245,158,11,0.15)", "#fde68a"), fontSize: 10 }}>{s.actionType}{s.actionValue != null ? ` ${s.actionValue}` : ""}</span>
          <span style={{ ...pill("transparent", statusColor), fontSize: 10, border: `1px solid ${statusColor}` }}>{s.status}</span>
        </div>
        <div style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 500, marginTop: 4 }} title={s.targetId}>
          {s.targetName ?? `id ${s.targetId}`}
        </div>
        <div style={{ fontSize: 11, color: "#8892a4", marginTop: 2 }}>{s.reason}</div>
        {s.expectedImpact && (
          <div style={{ fontSize: 11, color: "#a5b4fc", marginTop: 2 }}>
            Impact:&nbsp;
            {s.expectedImpact.savedSpend != null && <>save {fmt(s.expectedImpact.savedSpend, "currency", currency)} </>}
            {s.expectedImpact.addedSales != null && <>(±{fmt(s.expectedImpact.addedSales, "currency", currency)} sales) </>}
            {s.expectedImpact.note ?? ""}
          </div>
        )}
      </div>
      {s.status === "PENDING" && (
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button onClick={() => onUpdate(s.id, "APPROVED")} style={{ ...btnSecondary, color: "#86efac" }}>Approve</button>
          <button onClick={() => onUpdate(s.id, "DISMISSED")} style={{ ...btnSecondary, color: "#8892a4" }}>Dismiss</button>
        </div>
      )}
    </div>
  );
}

function Empty({ status, hasAccount }: { status: SuggestionStatus | "ANY"; hasAccount: boolean }) {
  return (
    <div style={{ background: "#161b27", border: "1px solid #2a3245", padding: 32, borderRadius: 10, textAlign: "center", color: "#8892a4" }}>
      No {status === "ANY" ? "" : status.toLowerCase() + " "}suggestions.{" "}
      {hasAccount ? "Create a rule on /rules and click ▶ Run rules now to generate some." : "Pick a brand from the top-right dropdown."}
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
function pill(bg: string, fg: string): React.CSSProperties {
  return { padding: "2px 6px", borderRadius: 4, background: bg, color: fg, fontWeight: 600 };
}
