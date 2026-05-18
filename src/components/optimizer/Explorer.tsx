"use client";
/**
 * Optimizer hierarchy explorer.
 *
 * Drills top-down: portfolio → campaigns → ad groups → keywords/targets.
 * Every row carries the latest suggestion (if any) plus inline action buttons
 * so reviewers can approve/apply/hold/dismiss without leaving the page.
 *
 * Server endpoint: /api/optimizer/explore — see its handler for shape.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { fmt } from "@/lib/utils";
import type { Bucket } from "@/lib/rules/types";

export type Level =
  | { type: "account" }
  | { type: "campaign"; campaignId: string; campaignName: string }
  | { type: "adgroup";  campaignId: string; campaignName: string; adGroupId: string; adGroupName: string };

const BUCKET_COLOR: Record<Bucket, { bg: string; fg: string; label: string }> = {
  SCALE_UP:   { bg: "var(--c-success-bg)", fg: "var(--c-success-text)",  label: "Scale up" },
  BID_UP:     { bg: "var(--c-success-bg)", fg: "var(--c-success-text)",  label: "Bid up"   },
  SCALE_DOWN: { bg: "var(--c-warning-bg)", fg: "var(--c-warning-text)",  label: "Scale down" },
  BID_DOWN:   { bg: "var(--c-warning-bg)", fg: "var(--c-warning-text)",  label: "Bid down" },
  PAUSE:      { bg: "var(--c-danger-bg)",  fg: "var(--c-danger-text)",   label: "Pause" },
  HOLD:       { bg: "var(--c-neutral-bg)", fg: "var(--c-neutral-text)",  label: "Hold" },
};

interface Metric { spend: number; sales: number; orders: number; clicks: number; impressions: number; acos: number | null; roas: number | null }
interface SuggestionLite {
  id: string; bucket: Bucket | null;
  actionType: string; actionValue: number | null; overrideValue: number | null; currentValue: number | null;
  reason: string; status: string; confidence: number | null; reviewer: string | null;
  createdAt: string; appliedAt: string | null;
}
type BucketCounts = Partial<Record<Bucket, number>>;

interface CampaignNode {
  campaignId: string; name: string | null; program: string; programKey: string;
  intent: string; state: string | null; dailyBudget: number | null;
  targetAcos: number | null; m7d: Metric; aiSuggestion: SuggestionLite | null; manualSuggestion: SuggestionLite | null;
  childBuckets: BucketCounts;
  notesCount: number;
}
interface AdGroupNode {
  adGroupId: string; name: string | null; campaignId: string; program: string;
  state: string | null; defaultBid: number | null; m7d: Metric; aiSuggestion: SuggestionLite | null; manualSuggestion: SuggestionLite | null;
  childBuckets: BucketCounts;
  notesCount: number;
}
interface TargetNode {
  targetId: string; adGroupId: string; campaignId: string; program: string;
  kind: string | null; matchType: string | null; display: string | null;
  state: string | null; bid: number | null; m7d: Metric; aiSuggestion: SuggestionLite | null; manualSuggestion: SuggestionLite | null;
  notesCount: number;
}

type NoteTargetType = "CAMPAIGN" | "AD_GROUP" | "KEYWORD" | "PRODUCT_TARGET";

type ExploreData =
  | { portfolio: Metric; campaigns: CampaignNode[] }
  | { campaign: CampaignNode & { state: string | null }; adGroups: AdGroupNode[] }
  | { adGroup:  AdGroupNode; targets: TargetNode[] }
  | { error: string };

interface Props {
  accountId: string;
  currency: string;
  reviewer: string;
  bucketFilter: Bucket | "ALL";
}

export default function Explorer({ accountId, currency, reviewer, bucketFilter }: Props) {
  const [level, setLevel] = useState<Level>({ type: "account" });
  const [data, setData] = useState<ExploreData | null>(null);
  const [loading, setLoading] = useState(false);

  // Reset to top whenever the active brand changes.
  useEffect(() => { setLevel({ type: "account" }); }, [accountId]);

  const load = useCallback(async () => {
    if (!accountId) { setData(null); return; }
    setLoading(true);
    try {
      let url = `/api/optimizer/explore?accountId=${accountId}`;
      if (level.type === "campaign") url += `&campaignId=${level.campaignId}`;
      if (level.type === "adgroup")  url += `&adGroupId=${level.adGroupId}`;
      const res = await fetch(url, { cache: "no-store" });
      setData(await res.json());
    } finally { setLoading(false); }
  }, [accountId, level]);

  useEffect(() => { void load(); }, [load]);

  if (!accountId) {
    return <div style={empty}>Pick a brand from the top-right dropdown.</div>;
  }
  if (loading && !data) {
    return <div style={empty}>Loading…</div>;
  }
  if (!data) return null;
  if ("error" in data) return <div style={{ ...empty, color: "var(--c-danger-text)" }}>{data.error}</div>;

  return (
    <div>
      <Breadcrumb level={level} onNavigate={setLevel} />

      {level.type === "account"  && "campaigns" in data && (
        <AccountView  data={data} accountId={accountId} bucketFilter={bucketFilter} currency={currency}
                      reviewer={reviewer} onDrill={setLevel} onApplied={load} />
      )}
      {level.type === "campaign" && "adGroups" in data && (
        <CampaignView data={data} accountId={accountId} level={level} bucketFilter={bucketFilter} currency={currency}
                      reviewer={reviewer} onDrill={setLevel} onApplied={load} />
      )}
      {level.type === "adgroup"  && "targets" in data && (
        <AdGroupView  data={data} accountId={accountId} bucketFilter={bucketFilter} currency={currency}
                      reviewer={reviewer} onApplied={load} />
      )}
    </div>
  );
}

// ─── Breadcrumb ─────────────────────────────────────────────────────────────

function Breadcrumb({ level, onNavigate }: { level: Level; onNavigate: (l: Level) => void }) {
  const crumbs: { label: string; level: Level }[] = [{ label: "All campaigns", level: { type: "account" } }];
  if (level.type === "campaign") {
    crumbs.push({ label: level.campaignName, level });
  } else if (level.type === "adgroup") {
    crumbs.push({
      label: level.campaignName,
      level: { type: "campaign", campaignId: level.campaignId, campaignName: level.campaignName },
    });
    crumbs.push({ label: level.adGroupName, level });
  }
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
      {crumbs.map((c, i) => (
        <span key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {i > 0 && <span style={{ color: "var(--text-muted)" }}>›</span>}
          <button
            onClick={() => i < crumbs.length - 1 && onNavigate(c.level)}
            disabled={i === crumbs.length - 1}
            style={{
              padding: "4px 10px", borderRadius: 4, fontSize: 12,
              background: "transparent",
              border: "1px solid var(--border)",
              color: i === crumbs.length - 1 ? "var(--text-primary)" : "var(--c-indigo-text)",
              cursor: i === crumbs.length - 1 ? "default" : "pointer",
              fontWeight: i === crumbs.length - 1 ? 600 : 400,
            }}
          >
            {c.label}
          </button>
        </span>
      ))}
    </div>
  );
}

// ─── Views ──────────────────────────────────────────────────────────────────

function AccountView({ data, accountId, bucketFilter, currency, reviewer, onDrill, onApplied }: {
  data: { portfolio: Metric; campaigns: CampaignNode[] };
  accountId: string;
  bucketFilter: Bucket | "ALL"; currency: string; reviewer: string;
  onDrill: (l: Level) => void; onApplied: () => void;
}) {
  const rows = useMemo(() =>
    data.campaigns.filter((c) =>
      bucketFilter === "ALL"
        || c.aiSuggestion?.bucket === bucketFilter
        || c.manualSuggestion?.bucket === bucketFilter
        || (c.childBuckets?.[bucketFilter as Bucket] ?? 0) > 0
    ).sort((a, b) => b.m7d.spend - a.m7d.spend),
    [data.campaigns, bucketFilter]);
  return (
    <>
      <SummaryCard
        title={`Portfolio (${data.campaigns.length} campaigns, last 7d)`}
        metric={data.portfolio}
        currency={currency}
      />
      <Table
        rows={rows.map((c) => ({
          key: c.campaignId,
          name: c.name ?? c.campaignId,
          subtitle: `${displayProgram(c.programKey)} · ${c.intent} · budget ${fmt(c.dailyBudget ?? 0, "currency", currency)}/d`,
          targetAcos: c.targetAcos,
          m7d: c.m7d,
          aiSuggestion:     c.aiSuggestion,
          manualSuggestion: c.manualSuggestion,
          childBuckets: c.childBuckets,
          notesCount: c.notesCount,
          noteTargetType: "CAMPAIGN",
          noteTargetId: c.campaignId,
          drill: () => onDrill({ type: "campaign", campaignId: c.campaignId, campaignName: c.name ?? c.campaignId }),
        }))}
        accountId={accountId}
        currency={currency}
        reviewer={reviewer}
        onApplied={onApplied}
        showDrill
        rowLevelLabel="Campaign"
      />
    </>
  );
}

function CampaignView({ data, accountId, level, bucketFilter, currency, reviewer, onDrill, onApplied }: {
  data: { campaign: CampaignNode; adGroups: AdGroupNode[] };
  accountId: string;
  level: Extract<Level, { type: "campaign" }>;
  bucketFilter: Bucket | "ALL"; currency: string; reviewer: string;
  onDrill: (l: Level) => void; onApplied: () => void;
}) {
  const rows = useMemo(() =>
    data.adGroups.filter((a) =>
      bucketFilter === "ALL"
        || a.aiSuggestion?.bucket === bucketFilter
        || a.manualSuggestion?.bucket === bucketFilter
        || (a.childBuckets?.[bucketFilter as Bucket] ?? 0) > 0
    ).sort((a, b) => b.m7d.spend - a.m7d.spend),
    [data.adGroups, bucketFilter]);
  return (
    <>
      <SummaryCard
        title={`${data.campaign.name ?? data.campaign.campaignId} (last 7d)`}
        subtitle={`Target ACOS: ${data.campaign.targetAcos != null ? `${data.campaign.targetAcos.toFixed(1)}%` : "default"} · ${displayProgram(data.campaign.programKey)} · ${data.campaign.intent}`}
        metric={data.campaign.m7d}
        currency={currency}
      />
      <Table
        rows={rows.map((a) => ({
          key: a.adGroupId,
          name: a.name ?? a.adGroupId,
          subtitle: `Default bid ${fmt(a.defaultBid ?? 0, "currency", currency)} · ${a.state ?? "—"}`,
          targetAcos: data.campaign.targetAcos,
          m7d: a.m7d,
          aiSuggestion:     a.aiSuggestion,
          manualSuggestion: a.manualSuggestion,
          childBuckets: a.childBuckets,
          notesCount: a.notesCount,
          noteTargetType: "AD_GROUP",
          noteTargetId: a.adGroupId,
          drill: () => onDrill({
            type: "adgroup",
            campaignId: level.campaignId, campaignName: level.campaignName,
            adGroupId: a.adGroupId, adGroupName: a.name ?? a.adGroupId,
          }),
        }))}
        accountId={accountId}
        currency={currency}
        reviewer={reviewer}
        onApplied={onApplied}
        showDrill
        rowLevelLabel="Ad group"
      />
    </>
  );
}

function AdGroupView({ data, accountId, bucketFilter, currency, reviewer, onApplied }: {
  data: { adGroup: AdGroupNode; targets: TargetNode[] };
  accountId: string;
  bucketFilter: Bucket | "ALL"; currency: string; reviewer: string;
  onApplied: () => void;
}) {
  const rows = useMemo(() =>
    data.targets.filter((t) =>
      bucketFilter === "ALL"
        || t.aiSuggestion?.bucket === bucketFilter
        || t.manualSuggestion?.bucket === bucketFilter
    ).sort((a, b) => b.m7d.spend - a.m7d.spend),
    [data.targets, bucketFilter]);
  return (
    <>
      <SummaryCard
        title={`${data.adGroup.name ?? data.adGroup.adGroupId} (last 7d)`}
        subtitle={`Default bid ${fmt(data.adGroup.defaultBid ?? 0, "currency", currency)} · ${data.adGroup.state ?? "—"}`}
        metric={data.adGroup.m7d}
        currency={currency}
      />
      <Table
        rows={rows.map((t) => ({
          key: t.targetId,
          name: t.display ?? t.targetId,
          subtitle: `${t.kind ?? ""}${t.matchType ? ` · ${t.matchType}` : ""}${t.state ? ` · ${t.state}` : ""}${t.bid != null ? ` · bid ${fmt(t.bid, "currency", currency)}` : ""}`,
          targetAcos: null,
          m7d: t.m7d,
          aiSuggestion:     t.aiSuggestion,
          manualSuggestion: t.manualSuggestion,
          notesCount: t.notesCount,
          noteTargetType: t.kind === "KEYWORD" ? "KEYWORD" : "PRODUCT_TARGET",
          noteTargetId: t.targetId,
        }))}
        accountId={accountId}
        currency={currency}
        reviewer={reviewer}
        onApplied={onApplied}
        rowLevelLabel="Target"
      />
    </>
  );
}

// ─── Pieces ─────────────────────────────────────────────────────────────────

function SummaryCard({ title, subtitle, metric, currency }: {
  title: string; subtitle?: string; metric: Metric; currency: string;
}) {
  return (
    <div style={{ ...card, padding: 14, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{title}</div>
          {subtitle && <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>{subtitle}</div>}
        </div>
        <Pill label="ACOS" value={metric.acos != null ? `${metric.acos.toFixed(1)}%` : "—"} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
        <Kpi label="Spend"  value={fmt(metric.spend,  "currency", currency)} />
        <Kpi label="Sales"  value={fmt(metric.sales,  "currency", currency)} />
        <Kpi label="Orders" value={String(metric.orders)} />
        <Kpi label="ROAS"   value={metric.roas != null ? `${metric.roas.toFixed(2)}x` : "—"} />
        <Kpi label="Clicks" value={String(metric.clicks)} />
      </div>
    </div>
  );
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "inline-flex", gap: 6, alignItems: "baseline", padding: "4px 10px", borderRadius: 6, background: "var(--bg-input)", fontSize: 12 }}>
      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: 14, color: "var(--text-primary)", marginTop: 2 }}>{value}</div>
    </div>
  );
}

// ─── Table ──────────────────────────────────────────────────────────────────

interface RowItem {
  key: string;
  name: string;
  subtitle: string;
  targetAcos: number | null;
  m7d: Metric;
  aiSuggestion:     SuggestionLite | null;
  manualSuggestion: SuggestionLite | null;
  childBuckets?: BucketCounts;
  notesCount?: number;
  noteTargetType?: NoteTargetType;
  noteTargetId?: string;
  drill?: () => void;
}

function Table({ rows, accountId, currency, reviewer, onApplied, showDrill, rowLevelLabel }: {
  rows: RowItem[]; accountId: string; currency: string; reviewer: string;
  onApplied: () => void; showDrill?: boolean; rowLevelLabel: string;
}) {
  if (rows.length === 0) {
    return <div style={empty}>No rows. Try changing the bucket filter or run the optimizer.</div>;
  }
  return (
    <div style={card}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--text-secondary)" }}>
              <Th align="left">{rowLevelLabel}</Th>
              <Th align="right">Spend</Th>
              <Th align="right">Sales</Th>
              <Th align="right">Orders</Th>
              <Th align="right">ACOS</Th>
              <Th align="right">Target</Th>
              <Th>Bucket / Why</Th>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <ExplorerRow key={r.key} r={r} accountId={accountId} currency={currency} reviewer={reviewer}
                           onApplied={onApplied} showDrill={!!showDrill} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ExplorerRow({ r, accountId, currency, reviewer, onApplied, showDrill }: {
  r: RowItem; accountId: string; currency: string; reviewer: string; onApplied: () => void; showDrill: boolean;
}) {
  const [notesOpen, setNotesOpen] = useState(false);
  const acosOver = r.targetAcos != null && r.m7d.acos != null && r.m7d.acos > r.targetAcos;
  const acosUnder = r.targetAcos != null && r.m7d.acos != null && r.m7d.acos < r.targetAcos * 0.8;
  const acosColor = acosOver ? "var(--c-danger-text)" : acosUnder ? "var(--c-success-text)" : "var(--text-primary)";

  return (
    <>
    <tr style={{ borderBottom: "1px solid var(--bg-input)" }}>
      <td style={{ padding: "10px 8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {showDrill && r.drill && (
            <button onClick={r.drill} style={drillBtn} title="Drill down">›</button>
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ color: "var(--text-primary)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 360 }} title={r.name}>{r.name}</div>
            <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 2 }}>{r.subtitle}</div>
          </div>
        </div>
      </td>
      <td style={tdR}>{fmt(r.m7d.spend, "currency", currency)}</td>
      <td style={tdR}>{fmt(r.m7d.sales, "currency", currency)}</td>
      <td style={tdR}>{r.m7d.orders}</td>
      <td style={{ ...tdR, color: acosColor, fontWeight: acosOver ? 600 : 400 }}>
        {r.m7d.acos != null ? `${r.m7d.acos.toFixed(1)}%` : "—"}
      </td>
      <td style={{ ...tdR, color: "var(--text-secondary)" }}>
        {r.targetAcos != null ? `${r.targetAcos.toFixed(1)}%` : "—"}
      </td>
      <td style={{ padding: "8px 6px", maxWidth: 380 }}>
        <SuggestionBlock label="AI"     sug={r.aiSuggestion} />
        <SuggestionBlock label="Manual" sug={r.manualSuggestion} />
        {!r.aiSuggestion && !r.manualSuggestion && (
          <span style={{ color: "var(--text-muted)", fontSize: 11 }}>No recent recommendation</span>
        )}
        <ChildBucketBadges counts={r.childBuckets} />
      </td>
      <td style={{ ...tdR, whiteSpace: "nowrap" }}>
        <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          {r.aiSuggestion?.status === "PENDING" && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
              <span style={sourceTag}>AI</span>
              <RowActions sug={r.aiSuggestion} currency={currency} reviewer={reviewer} onApplied={onApplied} />
            </div>
          )}
          {r.manualSuggestion?.status === "PENDING" && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
              <span style={sourceTag}>Rule</span>
              <RowActions sug={r.manualSuggestion} currency={currency} reviewer={reviewer} onApplied={onApplied} />
            </div>
          )}
          {!r.aiSuggestion?.status && !r.manualSuggestion?.status && (
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>—</span>
          )}
          {r.noteTargetType && r.noteTargetId && (
            <button onClick={() => setNotesOpen((v) => !v)} style={notesBtn} title="View / add notes">
              💬 {r.notesCount && r.notesCount > 0 ? r.notesCount : ""}
            </button>
          )}
        </div>
      </td>
    </tr>
    {notesOpen && r.noteTargetType && r.noteTargetId && (
      <tr>
        <td colSpan={9} style={{ padding: 0, background: "var(--bg-card)" }}>
          <NotesDrawer
            accountId={accountId}
            targetType={r.noteTargetType}
            targetId={r.noteTargetId}
            entityName={r.name}
            reviewer={reviewer}
            onClose={() => { setNotesOpen(false); onApplied(); }}
          />
        </td>
      </tr>
    )}
    </>
  );
}

// ─── Notes drawer ───────────────────────────────────────────────────────────

interface NoteRow {
  id: string; body: string; author: string | null; createdAt: string;
}

function NotesDrawer({ accountId, targetType, targetId, entityName, reviewer, onClose }: {
  accountId: string; targetType: NoteTargetType; targetId: string;
  entityName: string; reviewer: string;
  onClose: () => void;
}) {
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/notes?accountId=${accountId}&targetType=${targetType}&targetId=${targetId}`, { cache: "no-store" });
      const j = await res.json();
      setNotes(j.notes ?? []);
    } finally { setLoading(false); }
  }, [accountId, targetType, targetId]);
  useEffect(() => { void load(); }, [load]);

  async function submit() {
    if (!text.trim()) return;
    setSubmitting(true);
    try {
      await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId, targetType, targetId,
          body: text.trim(),
          author: reviewer || null,
        }),
      });
      setText("");
      await load();
    } finally { setSubmitting(false); }
  }

  return (
    <div style={drawerWrap}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Notes</div>
            <div style={{ fontSize: 12, color: "var(--text-primary)", maxWidth: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={entityName}>{entityName}</div>
          </div>
          <button onClick={onClose} style={{ ...notesBtn, padding: "4px 8px" }}>Close</button>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 10 }}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={reviewer ? `Add a note as ${reviewer}…` : "Add a note (set your name top-right for attribution)…"}
            rows={2}
            style={{
              flex: 1, background: "var(--bg-base)", border: "1px solid var(--border)", borderRadius: 6,
              color: "var(--text-primary)", padding: "6px 10px", fontSize: 12, resize: "vertical",
            }}
          />
          <button
            onClick={submit}
            disabled={!text.trim() || submitting}
            style={{
              padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: text.trim() ? "pointer" : "default",
              background: text.trim() ? "linear-gradient(135deg,#6366f1,#8b5cf6)" : "var(--bg-input)",
              color: text.trim() ? "#fff" : "var(--text-muted)",
              border: "1px solid transparent", whiteSpace: "nowrap",
            }}
          >
            {submitting ? "Saving…" : "Add note"}
          </button>
        </div>
        {loading ? (
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Loading…</div>
        ) : notes.length === 0 ? (
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>No notes yet. Be the first.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 280, overflowY: "auto" }}>
            {notes.map((n) => (
              <div key={n.id} style={{ background: "var(--bg-base)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px" }}>
                <div style={{ fontSize: 11, color: "var(--text-primary)", whiteSpace: "pre-wrap" }}>{n.body}</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 3 }}>
                  {n.author ?? "anonymous"} · {new Date(n.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

const drawerWrap: React.CSSProperties = {
  background: "var(--bg-base)", border: "1px solid var(--border)", borderRadius: 8,
  padding: 12, margin: "0 8px 8px 8px",
};
const notesBtn: React.CSSProperties = {
  padding: "3px 7px", borderRadius: 4, fontSize: 10, fontWeight: 500, cursor: "pointer",
  background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text-secondary)",
};
const sourceTag: React.CSSProperties = {
  display: "inline-block", padding: "1px 6px", borderRadius: 3,
  background: "var(--bg-input)", border: "1px solid var(--border)",
  color: "var(--text-secondary)",
  fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em",
};

function SuggestionBlock({ label, sug }: { label: "AI" | "Manual"; sug: SuggestionLite | null }) {
  if (!sug || !sug.bucket) return null;
  const bucket = sug.bucket;
  return (
    <div style={{ marginBottom: 6 }}>
      <span style={sourceTag}>{label}</span>
      <span style={{
        marginLeft: 6,
        padding: "2px 6px", borderRadius: 4,
        background: BUCKET_COLOR[bucket].bg, color: BUCKET_COLOR[bucket].fg,
        fontSize: 10, fontWeight: 600,
      }}>
        {BUCKET_COLOR[bucket].label}
      </span>
      <span style={{ marginLeft: 6, fontSize: 10, color: "var(--text-muted)" }}>
        {sug.status}{sug.reviewer ? ` · ${sug.reviewer}` : ""}{sug.confidence != null ? ` · ${Math.round(sug.confidence * 100)}%` : ""}
      </span>
      <div style={{ marginTop: 3, fontSize: 11, color: "var(--text-secondary)", maxWidth: 380 }}>{sug.reason}</div>
    </div>
  );
}

function ChildBucketBadges({ counts }: { counts: BucketCounts | undefined }) {
  if (!counts) return null;
  const entries = (Object.entries(counts) as [Bucket, number][])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;
  return (
    <div style={{ marginTop: 6, display: "flex", gap: 4, flexWrap: "wrap" }}>
      {entries.map(([b, n]) => (
        <span key={b} style={{
          padding: "1px 6px", borderRadius: 3, fontSize: 9, fontWeight: 600,
          background: BUCKET_COLOR[b].bg, color: BUCKET_COLOR[b].fg,
          opacity: 0.85,
        }} title={`${n} ${BUCKET_COLOR[b].label} suggestion${n>1?"s":""} inside — drill in to act on them`}>
          +{n} {BUCKET_COLOR[b].label}
        </span>
      ))}
    </div>
  );
}

function RowActions({ sug, currency, reviewer, onApplied }: {
  sug: SuggestionLite; currency: string; reviewer: string; onApplied: () => void;
}) {
  const [override, setOverride] = useState<string>(
    sug.overrideValue != null ? String(sug.overrideValue)
    : sug.actionValue != null ? String(sug.actionValue) : ""
  );
  const [busy, setBusy] = useState<"" | "APPROVE" | "APPLY" | "DISMISS" | "HOLD">("");

  const submit = async (status: "APPROVED" | "APPLIED" | "DISMISSED" | "HELD", apply: boolean) => {
    setBusy(status === "APPROVED" ? "APPROVE" : status === "APPLIED" ? "APPLY" : status === "DISMISSED" ? "DISMISS" : "HOLD");
    try {
      const overrideNum = override === "" ? undefined : parseFloat(override);
      const note = status === "DISMISSED" || status === "HELD"
        ? (window.prompt(`Note (required for ${status.toLowerCase()})`) ?? undefined) : undefined;
      if ((status === "DISMISSED" || status === "HELD") && !note) { setBusy(""); return; }

      const res = await fetch(`/api/suggestions/${sug.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, apply, overrideValue: overrideNum, reviewer, decisionNote: note }),
      });
      if (!res.ok && apply) {
        const j = await res.json().catch(() => ({}));
        alert(`Apply failed: ${j.message ?? j.error ?? res.status}`);
      }
      onApplied();
    } finally { setBusy(""); }
  };

  const isPause = sug.actionType === "PAUSE";
  return (
    <div style={{ display: "inline-flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
      {!isPause && sug.actionValue != null && (
        <div style={{ display: "flex", gap: 4, alignItems: "baseline" }}>
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
            {fmt(sug.currentValue ?? 0, "currency", currency)} →
          </span>
          <input
            type="number" step="0.01" value={override} onChange={(e) => setOverride(e.target.value)}
            style={overrideInput}
          />
        </div>
      )}
      <div style={{ display: "inline-flex", gap: 4 }}>
        <button onClick={() => submit("APPLIED",   true)}  disabled={!!busy} style={miniBtnPrimary}>{busy === "APPLY" ? "…" : "Apply"}</button>
        <button onClick={() => submit("APPROVED",  false)} disabled={!!busy} style={miniBtn}>Approve</button>
        <button onClick={() => submit("HELD",      false)} disabled={!!busy} style={miniBtn}>Hold</button>
        <button onClick={() => submit("DISMISSED", false)} disabled={!!busy} style={{ ...miniBtn, color: "var(--text-muted)" }}>✕</button>
      </div>
    </div>
  );
}

// ─── Utils ──────────────────────────────────────────────────────────────────

function displayProgram(p: string): string {
  if (p === "SB_VIDEO") return "SB Video";
  return p;
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const empty: React.CSSProperties = { padding: 24, textAlign: "center", color: "var(--text-secondary)", fontSize: 12 };
const card:  React.CSSProperties = { background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: 4 };
const tdR:   React.CSSProperties = { padding: "10px 8px", textAlign: "right", color: "var(--text-primary)", whiteSpace: "nowrap" };
const drillBtn: React.CSSProperties = {
  width: 22, height: 22, borderRadius: 4, fontSize: 16, fontWeight: 600,
  background: "var(--bg-input)", border: "1px solid var(--border)",
  color: "var(--c-indigo-text)", cursor: "pointer", flexShrink: 0,
};
const miniBtn: React.CSSProperties = {
  padding: "4px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: "pointer",
  background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--c-indigo-text)",
};
const miniBtnPrimary: React.CSSProperties = {
  padding: "4px 10px", borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: "pointer",
  background: "linear-gradient(135deg,#6366f1,#8b5cf6)", border: "1px solid transparent", color: "#fff",
};
const overrideInput: React.CSSProperties = {
  background: "var(--bg-base)", border: "1px solid var(--border)", borderRadius: 4,
  color: "var(--text-primary)", padding: "2px 6px", fontSize: 11, width: 70, textAlign: "right",
};

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <th style={{ textAlign: align, padding: "8px 6px", fontWeight: 500, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>{children}</th>;
}
