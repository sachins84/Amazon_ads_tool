"use client";
import { useEffect, useState, useCallback, useMemo } from "react";
import TopNav from "@/components/shared/TopNav";
import DataWindowBanner from "@/components/shared/DataWindowBanner";
import { fmt } from "@/lib/utils";
import { useAccount } from "@/lib/account-context";
import type { Suggestion, SuggestionStatus } from "@/lib/rules/types";

const STATUSES: (SuggestionStatus | "ANY")[] = ["PENDING", "APPROVED", "APPLIED", "DISMISSED", "HELD", "FAILED", "ANY"];

/** Subset of SuggestionStatus that counts as "acted" (reviewer has decided something). */
const ACTED: SuggestionStatus[] = ["APPROVED", "APPLIED", "DISMISSED", "HELD"];

export default function SuggestionsPage() {
  const { activeAccount } = useAccount();
  const accountId = activeAccount?.id ?? "";
  const currency = activeAccount?.adsMarketplace === "IN" ? "INR" : "USD";

  // Holds ALL recent suggestions (any status) — the summary table uses them
  // all; the list below filters by `status` for display.
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [status, setStatus] = useState<SuggestionStatus | "ANY">("ANY");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (accountId) qs.set("accountId", accountId);
    qs.set("status", "ANY");        // summary needs everything; list filters client-side
    const res = await fetch(`/api/suggestions?${qs}`);
    const j = await res.json();
    setSuggestions(j.suggestions ?? []);
    setLoading(false);
  }, [accountId]);

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

  const filtered = useMemo(() =>
    status === "ANY" ? suggestions : suggestions.filter((s) => s.status === status)
  , [suggestions, status]);

  const bulkApprove = async () => {
    if (!confirm(`Mark all ${filtered.length} visible suggestions as APPROVED?`)) return;
    setBulkBusy(true);
    await Promise.all(filtered.map((s) =>
      fetch(`/api/suggestions/${s.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "APPROVED" }) })
    ));
    setBulkBusy(false);
    load();
  };

  const bulkApply = async () => {
    if (!confirm(`Push all ${filtered.length} APPROVED suggestions to Amazon? This makes real changes.`)) return;
    setBulkBusy(true);
    let okCount = 0, failCount = 0;
    for (const s of filtered) {
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

  // ─── Daily summary ────────────────────────────────────────────────────────
  // Groups by created_at date; counts each status. Always derived from the
  // full unfiltered set so reviewers see actual activity.
  const dailySummary = useMemo(() => {
    const byDate = new Map<string, { suggested: number; pending: number; approved: number; applied: number; dismissed: number; held: number; failed: number }>();
    for (const s of suggestions) {
      const date = (s.createdAt ?? "").slice(0, 10);
      if (!date) continue;
      const row = byDate.get(date) ?? { suggested: 0, pending: 0, approved: 0, applied: 0, dismissed: 0, held: 0, failed: 0 };
      row.suggested++;
      if (s.status === "PENDING")   row.pending++;
      if (s.status === "APPROVED")  row.approved++;
      if (s.status === "APPLIED")   row.applied++;
      if (s.status === "DISMISSED") row.dismissed++;
      if (s.status === "HELD")      row.held++;
      if (s.status === "FAILED")    row.failed++;
      byDate.set(date, row);
    }
    return [...byDate.entries()]
      .map(([date, r]) => ({ date, ...r, acted: r.approved + r.applied + r.dismissed + r.held }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [suggestions]);

  // ─── List grouping ────────────────────────────────────────────────────────
  // Group the filtered list by created date so each section is one day.
  const groupedByDate = useMemo(() => {
    const map = new Map<string, Suggestion[]>();
    for (const s of filtered) {
      const date = (s.createdAt ?? "").slice(0, 10);
      const arr = map.get(date) ?? [];
      arr.push(s);
      map.set(date, arr);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  const totalSpendImpact = filtered
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
              {accountId ? `${activeAccount?.name} · ` : ""}{filtered.length} {status === "ANY" ? "" : status.toLowerCase()} suggestion{filtered.length === 1 ? "" : "s"} shown · {suggestions.length} total in window
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
            {status === "PENDING" && filtered.length > 0 && (
              <button onClick={bulkApprove} disabled={bulkBusy} style={btnSecondary}>
                Approve all
              </button>
            )}
            {status === "APPROVED" && filtered.length > 0 && (
              <button onClick={bulkApply} disabled={bulkBusy} style={btnPrimary(bulkBusy)}>
                {bulkBusy ? "Applying…" : `Apply all to Amazon (${filtered.length})`}
              </button>
            )}
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <DataWindowBanner accountId={accountId} window="Suggestion run window: Last 7D" />
        </div>

        {/* Daily summary: suggested vs acted per date */}
        <DailySummary rows={dailySummary} />

        {loading ? (
          <div style={{ color: "var(--text-secondary)", padding: 16 }}>Loading…</div>
        ) : groupedByDate.length === 0 ? (
          <Empty status={status} hasAccount={!!accountId} />
        ) : (
          groupedByDate.map(([date, items]) => (
            <DateGroup key={date} date={date} items={items} currency={currency} onUpdate={updateStatus} />
          ))
        )}
      </main>
    </div>
  );
}

// ─── Daily summary table ────────────────────────────────────────────────────

interface DailyRow {
  date: string;
  suggested: number; acted: number;
  pending: number; approved: number; applied: number; dismissed: number; held: number; failed: number;
}

function DailySummary({ rows }: { rows: DailyRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div style={{ ...card, padding: 14, marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
        Daily activity — suggested vs acted
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--text-secondary)" }}>
              <Th align="left">Date</Th>
              <Th align="right">Suggested</Th>
              <Th align="right">Acted</Th>
              <Th align="right">% Acted</Th>
              <Th align="right">Pending</Th>
              <Th align="right">Approved</Th>
              <Th align="right">Applied</Th>
              <Th align="right">Dismissed</Th>
              <Th align="right">Held</Th>
              <Th align="right">Failed</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const pct = r.suggested > 0 ? (r.acted / r.suggested) * 100 : 0;
              return (
                <tr key={r.date} style={{ borderBottom: "1px solid var(--bg-input)" }}>
                  <td style={tdL}>{r.date}</td>
                  <td style={tdR}>{r.suggested}</td>
                  <td style={tdR}>{r.acted}</td>
                  <td style={{ ...tdR, color: pct >= 80 ? "var(--c-success-text)" : pct >= 40 ? "var(--text-primary)" : "var(--c-warning-text)" }}>
                    {pct.toFixed(0)}%
                  </td>
                  <td style={{ ...tdR, color: r.pending > 0 ? "var(--c-indigo-text)" : "var(--text-muted)" }}>{r.pending}</td>
                  <td style={tdR}>{r.approved}</td>
                  <td style={{ ...tdR, color: r.applied > 0 ? "var(--c-success-text)" : "var(--text-muted)" }}>{r.applied}</td>
                  <td style={{ ...tdR, color: "var(--text-muted)" }}>{r.dismissed}</td>
                  <td style={{ ...tdR, color: "var(--text-muted)" }}>{r.held}</td>
                  <td style={{ ...tdR, color: r.failed > 0 ? "var(--c-danger-text)" : "var(--text-muted)" }}>{r.failed}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Date-grouped list ──────────────────────────────────────────────────────

function DateGroup({ date, items, currency, onUpdate }: {
  date: string;
  items: Suggestion[];
  currency: string;
  onUpdate: (id: string, s: SuggestionStatus, apply?: boolean) => void;
}) {
  const totalSpend = items.reduce((s, i) => s + (i.expectedImpact?.savedSpend ?? 0), 0);
  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: 16, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{prettyDate(date)}</div>
        <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
          {items.length} suggestion{items.length === 1 ? "" : "s"}
          {totalSpend > 0 && ` · est. ${fmt(totalSpend, "currency", currency)} savings`}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((s) => <SuggestionRow key={s.id} s={s} currency={currency} onUpdate={onUpdate} />)}
      </div>
    </div>
  );
}

function prettyDate(d: string): string {
  // d is YYYY-MM-DD. Render as "Mon, May 18" with day suffix.
  try {
    const dt = new Date(d + "T00:00:00Z");
    return dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  } catch { return d; }
}

function SuggestionRow({ s, currency, onUpdate }: { s: Suggestion; currency: string; onUpdate: (id: string, status: SuggestionStatus, apply?: boolean) => void }) {
  const statusColor = s.status === "PENDING" ? "var(--c-indigo-text)"
    : s.status === "APPROVED" ? "var(--c-warning-text)"
    : s.status === "APPLIED" ? "var(--c-success-text)"
    : s.status === "DISMISSED" ? "var(--text-muted)"
    : s.status === "HELD" ? "var(--text-muted)"
    : "var(--c-danger-text)";
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

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <th style={{ textAlign: align, padding: "6px 8px", fontWeight: 500, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>{children}</th>;
}

const card:  React.CSSProperties = { background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10 };
const tdL:   React.CSSProperties = { padding: "6px 8px", textAlign: "left",  color: "var(--text-primary)" };
const tdR:   React.CSSProperties = { padding: "6px 8px", textAlign: "right", color: "var(--text-primary)" };
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
