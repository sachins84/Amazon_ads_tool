"use client";
/**
 * /schedules — Campaign pause/unpause scheduler.
 *
 * Operators build a named list of campaigns and set pause and/or resume times
 * on chosen weekdays in a timezone. A server-side minute-tick fires the
 * actions automatically. Every schedule is OFF until explicitly enabled, and
 * makes REAL state changes to live Amazon campaigns when it fires.
 */
import { useState, useEffect, useCallback } from "react";
import TopNav from "@/components/shared/TopNav";
import { useAccount } from "@/lib/account-context";

const WEEKDAYS = [
  { v: 1, l: "Mon" }, { v: 2, l: "Tue" }, { v: 3, l: "Wed" }, { v: 4, l: "Thu" },
  { v: 5, l: "Fri" }, { v: 6, l: "Sat" }, { v: 0, l: "Sun" },
];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const TIMEZONES = [
  "Asia/Kolkata", "UTC", "America/Los_Angeles", "America/New_York",
  "Europe/London", "Asia/Dubai", "Asia/Singapore",
];

interface Campaign { campaignId: string; program: "SP" | "SB" | "SD"; name: string | null; state?: string }
interface ScheduleCampaign { campaignId: string; program: "SP" | "SB" | "SD"; name: string | null }
interface Run {
  id: string; action: "PAUSE" | "RESUME"; trigger: string; firedAt: string;
  campaignsTotal: number; okCount: number; failCount: number; message: string | null;
}
interface Schedule {
  id: string; accountId: string; name: string; enabled: boolean; timezone: string;
  pauseAt: string | null; resumeAt: string | null; daysOfWeek: number[];
  lastPauseAt: string | null; lastResumeAt: string | null; lastError: string | null;
  campaigns: ScheduleCampaign[];
}

export default function SchedulesPage() {
  const { activeAccount } = useAccount();
  const accountId = activeAccount?.id ?? "";
  const defaultTz = activeAccount?.adsMarketplace === "IN" ? "Asia/Kolkata" : "UTC";

  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Schedule | "new" | null>(null);

  const load = useCallback(async () => {
    if (!accountId) { setSchedules([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/schedules?accountId=${accountId}`, { cache: "no-store" });
      const j = await res.json();
      setSchedules(j.schedules ?? []);
    } finally { setLoading(false); }
  }, [accountId]);
  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-base)" }}>
      <TopNav />
      <main style={{ padding: "24px 28px", maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>Schedules</h1>
            <p style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
              {accountId ? `${activeAccount?.name} · ` : ""}Auto pause / resume campaigns at set times
            </p>
          </div>
          {accountId && (
            <button onClick={() => setEditing("new")} disabled={editing === "new"} style={btnPrimary(editing === "new")}>
              + New schedule
            </button>
          )}
        </div>

        <div style={{ background: "var(--c-warning-banner-bg)", border: "1px solid var(--c-warning-banner-bd)", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: "var(--c-warning-text)" }}>
          ⚠ Enabled schedules make <strong>real changes to live Amazon campaigns</strong> at the times below, on the server clock. Schedules are off until you toggle them on.
        </div>

        {!accountId ? (
          <Empty>Pick a brand from the top-right dropdown to manage its schedules.</Empty>
        ) : editing ? (
          <ScheduleEditor
            accountId={accountId}
            defaultTz={defaultTz}
            schedule={editing === "new" ? null : editing}
            onClose={() => setEditing(null)}
            onSaved={() => { setEditing(null); load(); }}
          />
        ) : loading ? (
          <Empty>Loading…</Empty>
        ) : schedules.length === 0 ? (
          <Empty>No schedules yet. Click “New schedule” to create one.</Empty>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {schedules.map((s) => (
              <ScheduleCard key={s.id} schedule={s} onChanged={load} onEdit={() => setEditing(s)} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

// ─── List card ───────────────────────────────────────────────────────────────

function ScheduleCard({ schedule, onChanged, onEdit }: { schedule: Schedule; onChanged: () => void; onEdit: () => void }) {
  const [busy, setBusy] = useState(false);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [showRuns, setShowRuns] = useState(false);

  const toggle = async () => {
    setBusy(true);
    try {
      await fetch(`/api/schedules/${schedule.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !schedule.enabled }),
      });
      onChanged();
    } finally { setBusy(false); }
  };

  const del = async () => {
    if (!confirm(`Delete schedule “${schedule.name}”?`)) return;
    setBusy(true);
    try { await fetch(`/api/schedules/${schedule.id}`, { method: "DELETE" }); onChanged(); }
    finally { setBusy(false); }
  };

  const runNow = async (action: "pause" | "resume") => {
    if (!confirm(`${action === "pause" ? "Pause" : "Resume"} ${schedule.campaigns.length} campaign(s) now? This changes live Amazon campaigns.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/schedules/${schedule.id}/run?action=${action}`, { method: "POST" });
      const j = await res.json();
      alert(j.result ? `${j.result.message} (${j.result.okCount} ok, ${j.result.failCount} failed)` : (j.error ?? "done"));
      await loadRuns(); onChanged();
    } finally { setBusy(false); }
  };

  const loadRuns = useCallback(async () => {
    const res = await fetch(`/api/schedules/${schedule.id}`, { cache: "no-store" });
    const j = await res.json();
    setRuns(j.runs ?? []);
  }, [schedule.id]);

  const openRuns = async () => { setShowRuns((v) => !v); if (!runs) await loadRuns(); };

  const dayLabel = schedule.daysOfWeek.length === 7 ? "Every day"
    : WEEKDAYS.filter((d) => schedule.daysOfWeek.includes(d.v)).map((d) => d.l).join(", ");

  return (
    <div style={{ ...card, padding: 14, opacity: schedule.enabled ? 1 : 0.72 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{schedule.name}</span>
            <span style={{ ...pill(schedule.enabled ? "var(--c-success-bg)" : "var(--bg-input)", schedule.enabled ? "var(--c-success-text)" : "var(--text-muted)") }}>
              {schedule.enabled ? "ON" : "OFF"}
            </span>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4, display: "flex", gap: 12, flexWrap: "wrap" }}>
            {schedule.pauseAt && <span>⏸ Pause {schedule.pauseAt}</span>}
            {schedule.resumeAt && <span>▶ Resume {schedule.resumeAt}</span>}
            <span>{dayLabel}</span>
            <span>{schedule.timezone}</span>
            <span>{schedule.campaigns.length} campaign{schedule.campaigns.length === 1 ? "" : "s"}</span>
          </div>
          {schedule.lastError && <div style={{ fontSize: 11, color: "var(--c-danger-text)", marginTop: 4 }}>Last error: {schedule.lastError}</div>}
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button onClick={toggle} disabled={busy} style={btnSecondary}>{schedule.enabled ? "Turn off" : "Turn on"}</button>
          <button onClick={() => runNow("pause")} disabled={busy} style={btnSecondary} title="Pause all now">⏸ now</button>
          <button onClick={() => runNow("resume")} disabled={busy} style={btnSecondary} title="Resume all now">▶ now</button>
          <button onClick={onEdit} disabled={busy} style={btnSecondary}>Edit</button>
          <button onClick={openRuns} disabled={busy} style={btnSecondary}>{showRuns ? "Hide" : "History"}</button>
          <button onClick={del} disabled={busy} style={{ ...btnSecondary, color: "var(--c-danger-text)" }}>Delete</button>
        </div>
      </div>

      {showRuns && (
        <div style={{ marginTop: 10, borderTop: "1px solid var(--bg-input)", paddingTop: 8 }}>
          {runs == null ? <div style={muted}>Loading…</div>
            : runs.length === 0 ? <div style={muted}>No runs yet.</div>
            : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {runs.map((r) => (
                  <div key={r.id} style={{ fontSize: 11, color: "var(--text-secondary)", display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ color: r.failCount > 0 ? "var(--c-danger-text)" : "var(--c-success-text)", fontWeight: 600 }}>{r.action}</span>
                    <span>{new Date(r.firedAt).toLocaleString()}</span>
                    <span>· {r.trigger}</span>
                    <span>· {r.okCount}/{r.campaignsTotal} ok{r.failCount ? `, ${r.failCount} failed` : ""}</span>
                    {r.message && <span style={{ color: "var(--text-muted)" }}>· {r.message}</span>}
                  </div>
                ))}
              </div>
            )}
        </div>
      )}
    </div>
  );
}

// ─── Editor ──────────────────────────────────────────────────────────────────

function ScheduleEditor({ accountId, defaultTz, schedule, onClose, onSaved }: {
  accountId: string; defaultTz: string; schedule: Schedule | null;
  onClose: () => void; onSaved: () => void;
}) {
  const [name, setName]         = useState(schedule?.name ?? "");
  const [timezone, setTimezone] = useState(schedule?.timezone ?? defaultTz);
  const [pauseAt, setPauseAt]   = useState(schedule?.pauseAt ?? "");
  const [resumeAt, setResumeAt] = useState(schedule?.resumeAt ?? "");
  const [days, setDays]         = useState<number[]>(schedule?.daysOfWeek ?? ALL_DAYS);
  const [enabled, setEnabled]   = useState(schedule?.enabled ?? false);
  const [selected, setSelected] = useState<ScheduleCampaign[]>(schedule?.campaigns ?? []);
  const [saving, setSaving]     = useState(false);
  const [err, setErr]           = useState<string | null>(null);

  // Campaign picker
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [search, setSearch] = useState("");
  useEffect(() => {
    fetch(`/api/campaigns?accountId=${accountId}`, { cache: "no-store" })
      .then((r) => r.json()).then((j) => setCampaigns(j.campaigns ?? [])).catch(() => setCampaigns([]));
  }, [accountId]);

  const selectedIds = new Set(selected.map((c) => c.campaignId));
  const toggleCampaign = (c: Campaign) => {
    setSelected((prev) => prev.some((x) => x.campaignId === c.campaignId)
      ? prev.filter((x) => x.campaignId !== c.campaignId)
      : [...prev, { campaignId: c.campaignId, program: c.program, name: c.name }]);
  };
  const toggleDay = (v: number) => setDays((prev) => prev.includes(v) ? prev.filter((d) => d !== v) : [...prev, v]);

  const visible = campaigns.filter((c) =>
    !search || (c.name ?? c.campaignId).toLowerCase().includes(search.toLowerCase()));

  const save = async () => {
    setErr(null);
    if (!name.trim()) return setErr("Name is required.");
    if (!pauseAt && !resumeAt) return setErr("Set at least one of pause time / resume time.");
    if (days.length === 0) return setErr("Select at least one weekday.");
    if (selected.length === 0) return setErr("Add at least one campaign.");

    setSaving(true);
    try {
      const body = {
        accountId, name: name.trim(), timezone,
        pauseAt: pauseAt || null, resumeAt: resumeAt || null,
        daysOfWeek: days, enabled, campaigns: selected,
      };
      const res = schedule
        ? await fetch(`/api/schedules/${schedule.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        : await fetch(`/api/schedules`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!res.ok) { setErr(j.error ?? "Save failed"); return; }
      onSaved();
    } finally { setSaving(false); }
  };

  return (
    <div style={{ ...card, padding: 18 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 14 }}>
        {schedule ? "Edit schedule" : "New schedule"}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Night-off generics" style={input} />
        </Field>
        <Field label="Timezone">
          <select value={timezone} onChange={(e) => setTimezone(e.target.value)} style={input}>
            {[...new Set([timezone, ...TIMEZONES])].map((tz) => <option key={tz} value={tz}>{tz}</option>)}
          </select>
        </Field>
        <Field label="Pause at (optional)">
          <input type="time" value={pauseAt} onChange={(e) => setPauseAt(e.target.value)} style={input} />
        </Field>
        <Field label="Resume at (optional)">
          <input type="time" value={resumeAt} onChange={(e) => setResumeAt(e.target.value)} style={input} />
        </Field>
      </div>

      <Field label="Days">
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {WEEKDAYS.map((d) => (
            <button key={d.v} onClick={() => toggleDay(d.v)} style={chip(days.includes(d.v))}>{d.l}</button>
          ))}
          <button onClick={() => setDays(days.length === 7 ? [] : ALL_DAYS)} style={{ ...chip(false), color: "var(--c-indigo-text)" }}>
            {days.length === 7 ? "Clear" : "Every day"}
          </button>
        </div>
      </Field>

      <div style={{ marginTop: 14 }}>
        <Field label={`Campaigns (${selected.length} selected)`}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search campaigns…" style={{ ...input, marginBottom: 6 }} />
          <div style={{ maxHeight: 240, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-base)" }}>
            {campaigns.length === 0 ? (
              <div style={{ ...muted, padding: 10 }}>No campaigns stored for this brand. Refresh from Amazon on the dashboard first.</div>
            ) : visible.length === 0 ? (
              <div style={{ ...muted, padding: 10 }}>No matches.</div>
            ) : visible.map((c) => (
              <label key={c.campaignId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderBottom: "1px solid var(--bg-input)", cursor: "pointer", fontSize: 12 }}>
                <input type="checkbox" checked={selectedIds.has(c.campaignId)} onChange={() => toggleCampaign(c)} />
                <span style={{ ...pill("var(--c-indigo-bg)", "var(--c-indigo-text)"), fontSize: 9 }}>{c.program}</span>
                <span style={{ color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.name ?? c.campaignId}>
                  {c.name ?? c.campaignId}
                </span>
                {c.state === "PAUSED" && <span style={{ ...pill("var(--c-warning-bg)", "var(--c-warning-text)"), fontSize: 9 }}>paused</span>}
              </label>
            ))}
          </div>
        </Field>
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 13, color: "var(--text-primary)", cursor: "pointer" }}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Enabled — fire automatically at the times above
      </label>

      {err && <div style={{ marginTop: 12, fontSize: 12, color: "var(--c-danger-text)" }}>{err}</div>}

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button onClick={save} disabled={saving} style={btnPrimary(saving)}>{saving ? "Saving…" : schedule ? "Save changes" : "Create schedule"}</button>
        <button onClick={onClose} disabled={saving} style={btnSecondary}>Cancel</button>
      </div>
    </div>
  );
}

// ─── Bits ─────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ ...card, padding: 28, textAlign: "center", color: "var(--text-secondary)", fontSize: 13 }}>{children}</div>;
}

const card: React.CSSProperties = { background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10 };
const muted: React.CSSProperties = { fontSize: 12, color: "var(--text-muted)" };
const input: React.CSSProperties = {
  background: "var(--bg-base)", border: "1px solid var(--border)", borderRadius: 6,
  color: "var(--text-primary)", padding: "7px 10px", fontSize: 12, outline: "none", width: "100%",
};
function pill(bg: string, fg: string): React.CSSProperties {
  return { padding: "2px 6px", borderRadius: 4, background: bg, color: fg, fontWeight: 600, fontSize: 10 };
}
function chip(on: boolean): React.CSSProperties {
  return {
    padding: "5px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
    background: on ? "var(--c-indigo-bg)" : "var(--bg-input)",
    color: on ? "var(--c-indigo-text)" : "var(--text-secondary)",
    border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
  };
}
const btnSecondary: React.CSSProperties = {
  padding: "6px 12px", borderRadius: 6, background: "var(--bg-input)",
  border: "1px solid var(--border)", color: "var(--text-secondary)", fontSize: 12, cursor: "pointer",
};
function btnPrimary(disabled: boolean): React.CSSProperties {
  return {
    padding: "7px 14px", borderRadius: 6,
    background: disabled ? "var(--bg-input)" : "linear-gradient(135deg,#6366f1,#8b5cf6)",
    border: "1px solid transparent", color: disabled ? "var(--text-muted)" : "#fff",
    fontSize: 12, fontWeight: 600, cursor: disabled ? "default" : "pointer",
  };
}
