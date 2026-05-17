"use client";
/**
 * /optimizer — AI optimization engine.
 *
 * User sets target ROAS + caps, clicks Run. The engine analyses every
 * campaign/ad-group/keyword over 1d/3d/7d windows + impression share + trend,
 * outputs bucketed suggestions (SCALE_UP, SCALE_DOWN, PAUSE, BID_UP, BID_DOWN).
 *
 * Reviewer can override any value before approving. Approve+Apply pushes
 * the change to Amazon. Action taken + reviewer are captured per row.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import TopNav from "@/components/shared/TopNav";
import { fmt } from "@/lib/utils";
import { useAccount } from "@/lib/account-context";
import type { Suggestion, Bucket, SuggestionStatus } from "@/lib/rules/types";
import { ALL_INTENTS, type Intent, intentLabel } from "@/lib/amazon-api/intent";
import { ALL_OPTIMIZER_PROGRAMS, ANY, type OptimizerProgram, type AcosTargetRow } from "@/lib/db/acos-targets-repo";

const BUCKETS: Bucket[] = ["SCALE_UP","BID_UP","SCALE_DOWN","BID_DOWN","PAUSE","HOLD"];

const BUCKET_COLOR: Record<Bucket, { bg: string; fg: string; label: string }> = {
  SCALE_UP:   { bg: "var(--c-success-bg)", fg: "var(--c-success-text)",  label: "Scale up" },
  BID_UP:     { bg: "var(--c-success-bg)", fg: "var(--c-success-text)",  label: "Bid up"   },
  SCALE_DOWN: { bg: "var(--c-warning-bg)", fg: "var(--c-warning-text)",  label: "Scale down" },
  BID_DOWN:   { bg: "var(--c-warning-bg)", fg: "var(--c-warning-text)",  label: "Bid down" },
  PAUSE:      { bg: "var(--c-danger-bg)",  fg: "var(--c-danger-text)",   label: "Pause" },
  HOLD:       { bg: "var(--c-neutral-bg)", fg: "var(--c-neutral-text)",  label: "Hold" },
};

export default function OptimizerPage() {
  const { activeAccount } = useAccount();
  const accountId = activeAccount?.id ?? "";
  const currency  = activeAccount?.adsMarketplace === "IN" ? "INR" : "USD";

  const [defaultTargetAcos,  setDefaultTargetAcos]  = useState("25");
  const [maxScaleUpPct,      setMaxScaleUpPct]      = useState("20");
  const [maxScaleDownPct,    setMaxScaleDownPct]    = useState("30");
  const [minSpendThreshold,  setMinSpendThreshold]  = useState("100");
  const [pauseZeroDays,      setPauseZeroDays]      = useState("7");

  const [bucketFilter, setBucketFilter] = useState<Bucket | "ALL">("ALL");
  const [statusFilter, setStatusFilter] = useState<SuggestionStatus | "PENDING">("PENDING");
  const [search,       setSearch]       = useState("");

  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [running,    setRunning]    = useState(false);
  const [runMsg,     setRunMsg]     = useState<string | null>(null);

  const [reviewer, setReviewer] = useState<string>(() => {
    if (typeof window !== "undefined") return localStorage.getItem("amazon-ads:reviewer") ?? "";
    return "";
  });
  useEffect(() => { if (reviewer) localStorage.setItem("amazon-ads:reviewer", reviewer); }, [reviewer]);

  const load = useCallback(async () => {
    if (!accountId) { setSuggestions([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/suggestions?accountId=${accountId}&status=${statusFilter}`);
      const j = await res.json() as { suggestions: Suggestion[] };
      setSuggestions((j.suggestions ?? []).filter((s) => s.bucket !== null));
    } finally { setLoading(false); }
  }, [accountId, statusFilter]);
  useEffect(() => { load(); }, [load]);

  const run = async () => {
    if (!accountId) { alert("Pick a brand first"); return; }
    if (!reviewer)  { alert("Enter your name (top right) so we can audit who approves what"); return; }
    setRunning(true); setRunMsg(null);
    try {
      const res = await fetch(`/api/optimizer/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId,
          objective: {
            defaultTargetAcos:       parseFloat(defaultTargetAcos),
            maxScaleUpPct:           parseFloat(maxScaleUpPct),
            maxScaleDownPct:         parseFloat(maxScaleDownPct),
            minSpendThreshold:       parseFloat(minSpendThreshold),
            pauseWhenOrdersZeroDays: parseInt(pauseZeroDays, 10),
          },
        }),
      });
      const j = await res.json() as { entitiesScored?: number; suggestionsCreated?: number; byBucket?: Record<string, number>; error?: string };
      if (j.error) throw new Error(j.error);
      const parts = Object.entries(j.byBucket ?? {}).map(([k, v]) => `${v} ${k}`).join(", ");
      setRunMsg(`Scored ${j.entitiesScored} entities → ${j.suggestionsCreated} suggestions  (${parts || "all HOLD"}).`);
      await load();
    } catch (e) {
      setRunMsg(`Error: ${String(e)}`);
    } finally {
      setRunning(false);
      setTimeout(() => setRunMsg(null), 8000);
    }
  };

  const filtered = useMemo(() => {
    return suggestions.filter((s) => {
      if (bucketFilter !== "ALL" && s.bucket !== bucketFilter) return false;
      if (search && !(s.targetName ?? "").toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [suggestions, bucketFilter, search]);

  const counts = useMemo(() => {
    const map: Partial<Record<Bucket, number>> = {};
    for (const s of suggestions) {
      if (s.bucket) map[s.bucket] = (map[s.bucket] ?? 0) + 1;
    }
    return map;
  }, [suggestions]);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-base)" }}>
      <TopNav />
      <main style={{ padding: "24px 28px", maxWidth: 1600, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>AI Optimizer</h1>
            <p style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
              {accountId ? `${activeAccount?.name} · ${currency}` : "Pick a brand to start"} · target ACOS per (program × intent), 1d/3d/7d windows, trend, impression share & CPC
            </p>
          </div>
          <input
            value={reviewer} onChange={(e) => setReviewer(e.target.value)}
            placeholder="Your name (for audit)" style={{ ...inputStyle, width: 200 }}
          />
        </div>

        {/* Target ACOS matrix */}
        <AcosTargetMatrix accountId={accountId} />

        {/* Objective + caps */}
        <div style={{ ...card, marginBottom: 14, padding: 16 }}>
          <div style={{ fontSize: 11, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Defaults & caps</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr) auto", gap: 12, alignItems: "end" }}>
            <Field label="Default ACOS % (fallback)">
              <input value={defaultTargetAcos} onChange={(e) => setDefaultTargetAcos(e.target.value)} type="number" step="0.5" min="0.5" style={inputStyle} />
            </Field>
            <Field label="Max scale-up %">
              <input value={maxScaleUpPct} onChange={(e) => setMaxScaleUpPct(e.target.value)} type="number" style={inputStyle} />
            </Field>
            <Field label="Max scale-down %">
              <input value={maxScaleDownPct} onChange={(e) => setMaxScaleDownPct(e.target.value)} type="number" style={inputStyle} />
            </Field>
            <Field label={`Min 7d spend (${currency})`}>
              <input value={minSpendThreshold} onChange={(e) => setMinSpendThreshold(e.target.value)} type="number" style={inputStyle} />
            </Field>
            <Field label="Pause after N zero-order days">
              <input value={pauseZeroDays} onChange={(e) => setPauseZeroDays(e.target.value)} type="number" style={inputStyle} />
            </Field>
            <button onClick={run} disabled={!accountId || running} style={btnPrimary(running)}>
              {running ? "Running…" : "▶ Run optimizer"}
            </button>
          </div>
          {runMsg && (
            <div style={{ marginTop: 10, padding: "8px 12px", background: "var(--c-info-banner-bg)", border: "1px solid var(--c-info-banner-bd)", color: "var(--c-indigo-text)", borderRadius: 6, fontSize: 12 }}>
              {runMsg}
            </div>
          )}
        </div>

        {/* Bucket + status filters */}
        <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--text-secondary)", marginRight: 6 }}>Bucket:</span>
          <button onClick={() => setBucketFilter("ALL")} style={chipStyleOn(bucketFilter === "ALL")}>All ({suggestions.length})</button>
          {BUCKETS.map((b) => (
            <button key={b} onClick={() => setBucketFilter(b)} style={{
              ...chipStyleOn(bucketFilter === b),
              background: bucketFilter === b ? BUCKET_COLOR[b].bg : "var(--bg-input)",
              color:      bucketFilter === b ? BUCKET_COLOR[b].fg : "var(--text-secondary)",
            }}>
              {BUCKET_COLOR[b].label} {counts[b] != null ? `(${counts[b]})` : ""}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as SuggestionStatus)} style={inputStyle}>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="APPLIED">Applied</option>
            <option value="DISMISSED">Dismissed</option>
            <option value="HELD">Held</option>
            <option value="FAILED">Failed</option>
            <option value="ANY">All statuses</option>
          </select>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name…" style={{ ...inputStyle, width: 200 }} />
        </div>

        {/* Table */}
        <div style={card}>
          {!accountId ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--text-secondary)" }}>Pick a brand from the top-right dropdown.</div>
          ) : loading ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--text-secondary)" }}>Loading…</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>
              No {statusFilter.toLowerCase()} suggestions{bucketFilter !== "ALL" ? ` in ${BUCKET_COLOR[bucketFilter as Bucket].label}` : ""}. Click ▶ Run optimizer above.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                    <Th>Bucket</Th><Th>Level</Th><Th align="left">Name</Th>
                    <Th align="right">Current</Th>
                    <Th align="right">Suggested</Th>
                    <Th align="right">Override</Th>
                    <Th align="left">Why</Th>
                    <Th align="right">Conf</Th>
                    <Th align="right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => (
                    <Row key={s.id} s={s} currency={currency} reviewer={reviewer} onApplied={load} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Outcomes — scored APPLIED suggestions */}
        <OutcomesPanel accountId={accountId} currency={currency} />
      </main>
    </div>
  );
}

function Row({ s, currency, reviewer, onApplied }: { s: Suggestion; currency: string; reviewer: string; onApplied: () => void }) {
  const [override, setOverride] = useState<string>(s.overrideValue != null ? String(s.overrideValue) : (s.actionValue != null ? String(s.actionValue) : ""));
  const [busy, setBusy] = useState<"" | "APPROVE" | "APPLY" | "DISMISS" | "HOLD">("");

  const submit = async (status: SuggestionStatus, apply: boolean) => {
    setBusy(status === "APPROVED" ? "APPROVE" : status === "APPLIED" ? "APPLY" : status === "DISMISSED" ? "DISMISS" : status === "HELD" ? "HOLD" : "");
    try {
      const overrideNum = override === "" ? undefined : parseFloat(override);
      const note = status === "DISMISSED" || status === "HELD" ? (window.prompt(`Note (required for ${status.toLowerCase()})`) ?? undefined) : undefined;
      if ((status === "DISMISSED" || status === "HELD") && !note) { setBusy(""); return; }

      const res = await fetch(`/api/suggestions/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status, apply,
          overrideValue: overrideNum,
          reviewer,
          decisionNote: note,
        }),
      });
      if (!res.ok && apply) {
        const j = await res.json().catch(() => ({}));
        alert(`Apply failed: ${j.message ?? j.error ?? res.status}`);
      }
      onApplied();
    } finally { setBusy(""); }
  };

  const bucket = s.bucket ?? "HOLD";
  const c = BUCKET_COLOR[bucket];
  const isApplied   = s.status === "APPLIED";
  const isDismissed = s.status === "DISMISSED";
  const isPending   = s.status === "PENDING";

  return (
    <tr style={{ borderBottom: "1px solid var(--bg-input)", opacity: isDismissed ? 0.5 : 1 }}>
      <Td><span style={{ padding: "2px 6px", borderRadius: 4, background: c.bg, color: c.fg, fontSize: 10, fontWeight: 600 }}>{c.label}</span></Td>
      <Td><span style={{ fontSize: 10, color: "var(--text-secondary)" }}>{s.targetType.replace("_"," ")}{s.program ? ` · ${s.program}` : ""}</span></Td>
      <Td style={{ color: "var(--text-primary)", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.targetName ?? s.targetId}>{s.targetName}</Td>
      <Td align="right" style={{ color: "var(--text-secondary)" }}>{s.currentValue != null ? fmt(s.currentValue, "currency", currency) : "—"}</Td>
      <Td align="right" style={{ color: "var(--text-primary)" }}>
        {s.actionType === "PAUSE" ? <span style={{ color: c.fg }}>PAUSE</span>
          : s.actionValue != null ? fmt(s.actionValue, "currency", currency) : "—"}
      </Td>
      <Td align="right">
        {s.actionType === "PAUSE" || s.actionValue == null ? <span style={{ color: "var(--text-muted)" }}>—</span> : (
          <input type="number" step="0.01" value={override} onChange={(e) => setOverride(e.target.value)} style={{ ...inputStyle, width: 100, textAlign: "right" }} disabled={!isPending} />
        )}
      </Td>
      <Td style={{ color: "var(--text-secondary)", maxWidth: 300, fontSize: 11 }}>{s.reason}</Td>
      <Td align="right" style={{ color: "var(--text-secondary)" }}>{s.confidence != null ? `${Math.round(s.confidence * 100)}%` : "—"}</Td>
      <Td align="right">
        {s.status !== "PENDING" ? (
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{s.status}{s.reviewer ? ` · ${s.reviewer}` : ""}</span>
        ) : (
          <div style={{ display: "inline-flex", gap: 4 }} onClick={(e) => e.stopPropagation()}>
            <button onClick={() => submit("APPLIED", true)} disabled={!!busy} style={miniBtnPrimary}>{busy === "APPLY" ? "…" : "Apply"}</button>
            <button onClick={() => submit("APPROVED", false)} disabled={!!busy} style={miniBtn}>Approve</button>
            <button onClick={() => submit("HELD", false)}     disabled={!!busy} style={miniBtn}>Hold</button>
            <button onClick={() => submit("DISMISSED", false)} disabled={!!busy} style={{ ...miniBtn, color: "var(--text-muted)" }}>✕</button>
          </div>
        )}
      </Td>
    </tr>
  );
}

// ─── ACOS target matrix editor ──────────────────────────────────────────────

const PROGRAM_LABEL: Record<OptimizerProgram, string> = {
  SP: "SP", SB: "SB", SB_VIDEO: "SB Video", SD: "SD",
};

type CellKey = `${OptimizerProgram | typeof ANY}|${Intent | typeof ANY}`;
type CellMap = Record<CellKey, string>; // string so blank cells stay editable

function AcosTargetMatrix({ accountId }: { accountId: string }) {
  const [cells, setCells] = useState<CellMap>({} as CellMap);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    const res = await fetch(`/api/optimizer/targets?accountId=${accountId}`, { cache: "no-store" });
    if (!res.ok) return;
    const j = await res.json() as { targets: AcosTargetRow[] };
    const next: CellMap = {} as CellMap;
    for (const t of j.targets) {
      next[`${t.program}|${t.intent}` as CellKey] = String(t.targetAcos);
    }
    setCells(next);
    setDirty(false);
  }, [accountId]);

  useEffect(() => { void load(); }, [load]);

  function setCell(p: OptimizerProgram | typeof ANY, i: Intent | typeof ANY, v: string) {
    const key = `${p}|${i}` as CellKey;
    setCells((prev) => ({ ...prev, [key]: v }));
    setDirty(true);
  }

  async function save() {
    if (!accountId) return;
    setSaving(true);
    try {
      const targets: AcosTargetRow[] = [];
      for (const [key, val] of Object.entries(cells)) {
        const trimmed = String(val ?? "").trim();
        if (!trimmed) continue;
        const num = parseFloat(trimmed);
        if (!Number.isFinite(num) || num <= 0) continue;
        const [program, intent] = key.split("|") as [AcosTargetRow["program"], AcosTargetRow["intent"]];
        targets.push({ program, intent, targetAcos: num });
      }
      await fetch(`/api/optimizer/targets?accountId=${accountId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets }),
      });
      setDirty(false);
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 2500);
    } finally { setSaving(false); }
  }

  // Display rows: each intent + an "Any intent" row. Columns: each program + "Any program".
  const intentRows: (Intent | typeof ANY)[] = [...ALL_INTENTS, ANY];
  const programCols: (OptimizerProgram | typeof ANY)[] = [...ALL_OPTIMIZER_PROGRAMS, ANY];

  if (!accountId) return null;

  return (
    <div style={{ ...card, marginBottom: 14, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Target ACOS matrix (%)
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
            Most specific cell wins. Leave blank to fall back to (program → intent → default).
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {savedAt && <span style={{ fontSize: 11, color: "var(--c-success-text)" }}>Saved.</span>}
          <button
            onClick={save}
            disabled={!dirty || saving}
            style={{ ...chipStyleOn(false), background: dirty ? "linear-gradient(135deg,#6366f1,#8b5cf6)" : "var(--bg-input)", color: dirty ? "#fff" : "var(--text-muted)", border: "1px solid transparent", padding: "6px 14px" }}
          >
            {saving ? "Saving…" : "Save matrix"}
          </button>
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr style={{ color: "var(--text-secondary)" }}>
              <th style={{ padding: "6px 8px", textAlign: "left", fontWeight: 500 }}>Intent ↓ / Program →</th>
              {programCols.map((p) => (
                <th key={p} style={{ padding: "6px 8px", fontWeight: 600, color: p === ANY ? "var(--text-muted)" : "var(--text-primary)", minWidth: 78 }}>
                  {p === ANY ? "Any" : PROGRAM_LABEL[p as OptimizerProgram]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {intentRows.map((i) => (
              <tr key={i} style={{ borderTop: "1px solid var(--bg-input)" }}>
                <td style={{ padding: "4px 8px", color: i === ANY ? "var(--text-muted)" : "var(--text-primary)", fontWeight: 500 }}>
                  {i === ANY ? "Any" : intentLabel(i as Intent)}
                </td>
                {programCols.map((p) => {
                  const key = `${p}|${i}` as CellKey;
                  const v = cells[key] ?? "";
                  const isFallback = p === ANY || i === ANY;
                  return (
                    <td key={key} style={{ padding: 2 }}>
                      <input
                        value={v}
                        onChange={(e) => setCell(p, i, e.target.value)}
                        type="number"
                        step="1"
                        min="1"
                        placeholder={isFallback ? "—" : ""}
                        style={{
                          ...inputStyle,
                          width: 70, textAlign: "right",
                          padding: "4px 8px", fontSize: 11,
                          background: isFallback ? "var(--bg-base)" : "var(--bg-input)",
                          color: v ? "var(--text-primary)" : "var(--text-muted)",
                        }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Outcomes panel ─────────────────────────────────────────────────────────

interface OutcomeRow {
  suggestion_id: string;
  window_days: number;
  spend_before: number; sales_before: number; orders_before: number; roas_before: number | null;
  spend_after:  number; sales_after:  number; orders_after:  number; roas_after:  number | null;
  captured_at: string;
}

interface AppliedRow {
  id: string;
  target_type: string;
  target_id: string;
  target_name: string | null;
  program: string | null;
  action_type: string;
  action_value: number | null;
  override_value: number | null;
  current_value: number | null;
  bucket: Bucket | null;
  reason: string;
  applied_at: string;
  reviewer: string | null;
}

const OUTCOME_WINDOWS = [1, 3, 7, 14] as const;

function OutcomesPanel({ accountId, currency }: { accountId: string; currency: string }) {
  const [data, setData] = useState<{ suggestions: AppliedRow[]; outcomes: Record<string, OutcomeRow[]> }>({ suggestions: [], outcomes: {} });
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/optimizer/outcomes?accountId=${accountId}&limit=200`, { cache: "no-store" });
      if (res.ok) setData(await res.json());
    } finally { setLoading(false); }
  }, [accountId]);

  useEffect(() => { void load(); }, [load]);

  async function recapture() {
    if (!accountId) return;
    setRefreshing(true);
    try {
      await fetch(`/api/optimizer/outcomes?accountId=${accountId}`, { method: "POST" });
      await load();
    } finally { setRefreshing(false); }
  }

  if (!accountId) return null;

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
        <div>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>Outcomes</h2>
          <p style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>
            Applied suggestions, scored against the same N-day window before vs after — feeds future engine tuning.
          </p>
        </div>
        <button onClick={recapture} disabled={refreshing} style={{ ...chipStyleOn(false), opacity: refreshing ? 0.6 : 1 }}>
          {refreshing ? "Scoring…" : "↻ Recapture"}
        </button>
      </div>

      <div style={card}>
        {loading ? (
          <div style={{ padding: 18, textAlign: "center", color: "var(--text-secondary)", fontSize: 12 }}>Loading…</div>
        ) : data.suggestions.length === 0 ? (
          <div style={{ padding: 18, textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
            No applied suggestions yet. Apply one above and outcomes will land here as days pass.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                  <Th>Applied</Th>
                  <Th>Bucket</Th>
                  <Th align="left">Name</Th>
                  <Th align="right">Action</Th>
                  {OUTCOME_WINDOWS.map((w) => <Th key={w} align="right">{w}d ROAS</Th>)}
                </tr>
              </thead>
              <tbody>
                {data.suggestions.map((s) => (
                  <OutcomeTableRow
                    key={s.id}
                    s={s}
                    outcomes={data.outcomes[s.id] ?? []}
                    currency={currency}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function OutcomeTableRow({ s, outcomes, currency }: { s: AppliedRow; outcomes: OutcomeRow[]; currency: string }) {
  const byWindow = new Map(outcomes.map((o) => [o.window_days, o]));
  const bucket = s.bucket ?? "HOLD";
  const c = BUCKET_COLOR[bucket];
  const appliedDate = s.applied_at.slice(0, 10);
  const action = s.action_type === "PAUSE"
    ? "PAUSE"
    : (s.override_value ?? s.action_value) != null
      ? fmt(s.override_value ?? s.action_value!, "currency", currency)
      : "—";

  return (
    <tr style={{ borderBottom: "1px solid var(--bg-input)" }}>
      <Td style={{ color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{appliedDate}</Td>
      <Td><span style={{ padding: "2px 6px", borderRadius: 4, background: c.bg, color: c.fg, fontSize: 10, fontWeight: 600 }}>{c.label}</span></Td>
      <Td style={{ color: "var(--text-primary)", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.target_name ?? s.target_id}>
        {s.target_name ?? s.target_id}
        <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{s.target_type.replace("_"," ")}{s.program ? ` · ${s.program}` : ""}</div>
      </Td>
      <Td align="right" style={{ color: "var(--text-primary)", whiteSpace: "nowrap" }}>{action}</Td>
      {OUTCOME_WINDOWS.map((w) => {
        const o = byWindow.get(w);
        if (!o) return <Td key={w} align="right"><span style={{ color: "var(--text-muted)" }}>—</span></Td>;
        return <Td key={w} align="right"><RoasDelta before={o.roas_before} after={o.roas_after} spendAfter={o.spend_after} /></Td>;
      })}
    </tr>
  );
}

function RoasDelta({ before, after, spendAfter }: { before: number | null; after: number | null; spendAfter: number }) {
  const fmtRoas = (v: number | null) => (v == null ? "—" : v.toFixed(2));
  const delta = before != null && after != null && before > 0 ? ((after - before) / before) * 100 : null;
  const noSpend = !spendAfter;

  const color = noSpend
    ? "var(--text-muted)"
    : delta == null ? "var(--text-secondary)"
    : delta >= 5 ? "var(--c-success-text)"
    : delta <= -5 ? "var(--c-danger-text)"
    : "var(--text-secondary)";

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", lineHeight: 1.1 }}>
      <span style={{ color: "var(--text-primary)" }}>{fmtRoas(before)} → {fmtRoas(after)}</span>
      {delta != null && (
        <span style={{ fontSize: 9, color }}>
          {delta >= 0 ? "↑" : "↓"} {Math.abs(delta).toFixed(0)}%
        </span>
      )}
      {noSpend && <span style={{ fontSize: 9, color }}>no spend</span>}
    </div>
  );
}

// ─── Style helpers ─────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--text-secondary)", marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}
function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <th style={{ textAlign: align, padding: "8px 6px", fontWeight: 500, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>{children}</th>;
}
function Td({ children, align = "left", style, title }: { children: React.ReactNode; align?: "left" | "right"; style?: React.CSSProperties; title?: string }) {
  return <td style={{ textAlign: align, padding: "8px 6px", ...style }} title={title}>{children}</td>;
}
function chipStyleOn(on: boolean): React.CSSProperties {
  return {
    padding: "5px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
    background: on ? "var(--c-indigo-bg)" : "var(--bg-input)",
    color:      on ? "var(--c-indigo-text)" : "var(--text-secondary)",
    border:    `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
  };
}

const card: React.CSSProperties = {
  background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: 4,
};
const inputStyle: React.CSSProperties = {
  background: "var(--bg-base)", border: "1px solid var(--border)", borderRadius: 6,
  color: "var(--text-primary)", padding: "6px 10px", fontSize: 12, outline: "none", width: "100%",
};
const miniBtn: React.CSSProperties = {
  padding: "4px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: "pointer",
  background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--c-indigo-text)",
};
const miniBtnPrimary: React.CSSProperties = {
  padding: "4px 10px", borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: "pointer",
  background: "linear-gradient(135deg,#6366f1,#8b5cf6)", border: "1px solid transparent", color: "#fff",
};
function btnPrimary(disabled: boolean): React.CSSProperties {
  return {
    padding: "8px 16px", borderRadius: 6,
    background: disabled ? "var(--bg-input)" : "linear-gradient(135deg,#6366f1,#8b5cf6)",
    border: "1px solid transparent",
    color: disabled ? "var(--text-muted)" : "#fff",
    fontSize: 12, fontWeight: 600, cursor: disabled ? "default" : "pointer", whiteSpace: "nowrap",
  };
}
