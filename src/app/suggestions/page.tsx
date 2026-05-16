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

  const updateStatus = async (id: string, newStatus: SuggestionStatus, apply = false) => {
    const res = await fetch(`/api/suggestions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus, apply }),
    });
    if (!res.ok && apply) {
      const j = await res.json().catch(() => ({}));
      alert(`Apply failed: ${j.message ?? j.error ?? res.status}`);
    }
    load();
  };

  const bulkApprove = async () => {
    if (!confirm(`Mark all ${suggestions.length} suggestions as APPROVED?`)) return;
    setBulkBusy(true);
    await Promise.all(suggestions.map((s) =>
      fetch(`/api/suggestions/${s.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "APPROVED" }) })
    ));
    setBulkBusy(false);
    load();
  };

  const bulkApply = async () => {
    if (!confirm(`Push all ${suggestions.length} APPROVED suggestions to Amazon? This makes real changes.`)) return;
    setBulkBusy(true);
    let okCount = 0, failCount = 0;
    for (const s of suggestions) {
      const res = await fetch(`/api/suggestions/${s.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "APPLIED", apply: true }),
      });
      if (res.ok) okCount += 1; else failCount += 1;
    }
    setBulkBusy(false);
    alert(`Applied ${okCount}, failed ${failCount}.`);
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
    <div style={{ minHeight: "100vh", background: "var(--bg-base)" }}>
      <TopNav />
      <main style={{ padding: "24px 28px", maxWidth: 1400, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>Suggestions</h1>
            <p style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
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
            {status === "APPROVED" && suggestions.length > 0 && (
              <button onClick={bulkApply} disabled={bulkBusy} style={btnPrimary(bulkBusy)}>
                {bulkBusy ? "Applying…" : `Apply all to Amazon (${suggestions.length})`}
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div style={{ color: "var(--text-secondary)", padding: 16 }}>Loading…</div>
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
  onUpdate: (id: string, s: SuggestionStatus, apply?: boolean) => void;
}) {
  const totalSpend = items.reduce((s, i) => s + (i.expectedImpact?.savedSpend ?? 0), 0);
  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: 16, marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 10 }}>
        Rule <code style={{ color: "var(--c-indigo-text)" }}>{ruleId.slice(0, 8)}</code> · {items.length} suggestion{items.length === 1 ? "" : "s"}
        {totalSpend > 0 && ` · est. ${fmt(totalSpend, "currency", currency)} savings`}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((s) => <SuggestionRow key={s.id} s={s} currency={currency} onUpdate={onUpdate} />)}
      </div>
    </div>
  );
}

function SuggestionRow({ s, currency, onUpdate }: { s: Suggestion; currency: string; onUpdate: (id: string, status: SuggestionStatus, apply?: boolean) => void }) {
  const statusColor = s.status === "PENDING" ? "var(--c-indigo-text)"
    : s.status === "APPROVED" ? "var(--c-warning-text)"
    : s.status === "APPLIED" ? "var(--c-success-text)"
    : s.status === "DISMISSED" ? "var(--text-muted)"
    : "#ef4444";
  return (
    <div style={{ borderTop: "1px solid var(--bg-input)", paddingTop: 10, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ ...pill("var(--border)", "var(--c-indigo-text)"), fontSize: 10 }}>{s.targetType}</span>
          {s.program && <span style={{ ...pill("var(--c-indigo-bg)", "var(--c-indigo-text)"), fontSize: 10 }}>{s.program}</span>}
          <span style={{ ...pill("var(--c-warning-bg)", "var(--c-warning-text)"), fontSize: 10 }}>{s.actionType}{s.actionValue != null ? ` ${s.actionValue}` : ""}</span>
          <span style={{ ...pill("transparent", statusColor), fontSize: 10, border: `1px solid ${statusColor}` }}>{s.status}</span>
        </div>
        <div style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 500, marginTop: 4 }} title={s.targetId}>
          {s.targetName ?? `id ${s.targetId}`}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>{s.reason}</div>
        {s.expectedImpact && (
          <div style={{ fontSize: 11, color: "var(--c-indigo-text)", marginTop: 2 }}>
            Impact:&nbsp;
            {s.expectedImpact.savedSpend != null && <>save {fmt(s.expectedImpact.savedSpend, "currency", currency)} </>}
            {s.expectedImpact.addedSales != null && <>(±{fmt(s.expectedImpact.addedSales, "currency", currency)} sales) </>}
            {s.expectedImpact.note ?? ""}
          </div>
        )}
      </div>
      {s.status === "PENDING" && (
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button onClick={() => onUpdate(s.id, "APPROVED")} style={{ ...btnSecondary, color: "var(--c-success-text)" }}>Approve</button>
          <button onClick={() => onUpdate(s.id, "DISMISSED")} style={{ ...btnSecondary, color: "var(--text-secondary)" }}>Dismiss</button>
        </div>
      )}
      {s.status === "APPROVED" && (
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button onClick={() => onUpdate(s.id, "APPLIED", true)} style={{ ...btnSecondary, color: "var(--c-indigo-text)", borderColor: "#6366f1" }} title="Push to Amazon">Apply to Amazon</button>
          <button onClick={() => onUpdate(s.id, "DISMISSED")} style={{ ...btnSecondary, color: "var(--text-secondary)" }}>Dismiss</button>
        </div>
      )}
    </div>
  );
}

function Empty({ status, hasAccount }: { status: SuggestionStatus | "ANY"; hasAccount: boolean }) {
  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", padding: 32, borderRadius: 10, textAlign: "center", color: "var(--text-secondary)" }}>
      No {status === "ANY" ? "" : status.toLowerCase() + " "}suggestions.{" "}
      {hasAccount ? "Create a rule on /rules and click ▶ Run rules now to generate some." : "Pick a brand from the top-right dropdown."}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "var(--bg-base)", border: "1px solid var(--border)", borderRadius: 6,
  color: "var(--text-primary)", padding: "6px 10px", fontSize: 12, outline: "none",
};
const btnSecondary: React.CSSProperties = {
  padding: "6px 12px", borderRadius: 6, background: "var(--bg-input)",
  border: "1px solid var(--border)", color: "var(--text-secondary)", fontSize: 12, cursor: "pointer",
};
function btnPrimary(disabled: boolean): React.CSSProperties {
  return {
    padding: "6px 14px", borderRadius: 6,
    background: disabled ? "var(--bg-input)" : "linear-gradient(135deg,#6366f1,#8b5cf6)",
    border: "1px solid",
    borderColor: disabled ? "var(--border)" : "transparent",
    color: disabled ? "var(--text-muted)" : "#fff",
    fontSize: 12, fontWeight: 600,
    cursor: disabled ? "default" : "pointer",
  };
}
function pill(bg: string, fg: string): React.CSSProperties {
  return { padding: "2px 6px", borderRadius: 4, background: bg, color: fg, fontWeight: 600 };
}
