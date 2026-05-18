"use client";
/**
 * Compact chip showing the analytical window a tab acts on plus how fresh
 * the underlying metrics store is. Renders nothing until the refresh
 * state lands, so the layout doesn't jump.
 *
 * Drop it under any tab's <h1> with a one-liner describing the window:
 *   <DataWindowBanner accountId={...} window="Last 7D" />
 *   <DataWindowBanner accountId={...} window="Last 1d / 3d / 7d (engine)" />
 */
import { useEffect, useState } from "react";

interface RefreshState {
  accountId: string;
  level: string;
  lastRefreshAt: string;
  windowStart: string;
  windowEnd: string;
  rowsUpserted: number;
  error: string | null;
}

export default function DataWindowBanner({
  accountId,
  window,
  level = "campaigns",
}: {
  accountId: string;
  window: string;
  level?: "campaigns" | "adgroups" | "targeting";
}) {
  const [state, setState] = useState<RefreshState | null>(null);
  const [coverageMax, setCoverageMax] = useState<string | null>(null);

  useEffect(() => {
    if (!accountId) { setState(null); return; }
    fetch(`/api/admin/refresh`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { states: RefreshState[] }) => {
        const mine = (j.states ?? []).filter((s) => s.accountId === accountId);
        const target = mine.find((s) => s.level === level) ?? mine[0] ?? null;
        setState(target);
        setCoverageMax(target?.windowEnd ?? null);
      })
      .catch(() => setState(null));
  }, [accountId, level]);

  if (!accountId) return null;
  if (!state) {
    return (
      <div style={chip}>
        <span style={dim}>Data window:</span> <span style={strong}>{window}</span>
      </div>
    );
  }

  const lastRefreshLocal = new Date(state.lastRefreshAt).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const stale = isStale(state.lastRefreshAt);
  const errored = !!state.error;

  return (
    <div style={chip}>
      <span style={dim}>Data window:</span> <span style={strong}>{window}</span>
      <Sep />
      <span style={dim}>Store:</span> <span style={strong}>up to {coverageMax ?? "—"}</span>
      <Sep />
      <span style={dim}>Last refresh:</span>{" "}
      <span style={{ ...strong, color: stale ? "var(--c-warning-text)" : "var(--text-primary)" }}>
        {lastRefreshLocal}{stale ? " · stale" : ""}
      </span>
      {errored && (
        <>
          <Sep />
          <span style={{ ...strong, color: "var(--c-danger-text)" }} title={state.error ?? ""}>
            partial errors
          </span>
        </>
      )}
    </div>
  );
}

function isStale(lastRefreshAt: string): boolean {
  const age = Date.now() - Date.parse(lastRefreshAt);
  return age > 36 * 60 * 60 * 1000; // > 36h
}

function Sep() { return <span style={dim}>·</span>; }

const chip: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap",
  padding: "5px 10px", borderRadius: 6,
  background: "var(--bg-input)", border: "1px solid var(--border)",
  fontSize: 11, color: "var(--text-primary)",
};
const dim:    React.CSSProperties = { color: "var(--text-secondary)" };
const strong: React.CSSProperties = { color: "var(--text-primary)", fontWeight: 500 };
