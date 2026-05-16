"use client";
/**
 * Targeting 360 — two modes:
 *   1. Hierarchy: Campaigns → Ad Groups → Keywords/Targets (top-down drill).
 *   2. All Keywords: flat list of every keyword/target with filters.
 *
 * All data from the SQLite metrics store (populated by daily 8 AM refresh).
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import TopNav from "@/components/shared/TopNav";
import DateRangePicker from "@/components/shared/DateRangePicker";
import { fmt } from "@/lib/utils";
import { useAccount } from "@/lib/account-context";
import { queueSuggestion } from "@/lib/api-client";

// ─── Types ───────────────────────────────────────────────────────────────────
type Program = "SP" | "SB" | "SD";
type Status  = "ENABLED" | "PAUSED" | "ARCHIVED";

type Intent = "BRANDED" | "GENERIC" | "COMPETITION" | "AUTO" | "PAT" | "OTHER";

interface CampaignRow {
  id: string; name: string; type: Program; status: Status;
  budget: number; portfolioId: string | null;
  targetingType?: "MANUAL" | "AUTO";
  intent: Intent;
  spend: number; sales: number; orders: number;
  impressions: number; clicks: number;
  ctr: number; cpc: number; cvr: number; acos: number; roas: number;
}
interface AdGroupRow {
  id: string; name: string; type: Program; status: Status;
  defaultBid: number; campaignId: string;
  spend: number; sales: number; orders: number;
  impressions: number; clicks: number;
  ctr: number; cpc: number; cvr: number; acos: number; roas: number;
}
interface TargetingRow {
  id: string; kind: "KEYWORD" | "PRODUCT_TARGET" | "AUTO"; display: string;
  matchType?: "EXACT" | "PHRASE" | "BROAD";
  state: Status; bid: number;
  campaignId: string; adGroupId: string;
  spend: number; sales: number; orders: number;
  impressions: number; clicks: number;
  ctr: number; cpc: number; cvr: number; acos: number; roas: number;
}

// Flat-list response shape from /api/targeting (existing endpoint)
interface FlatTarget {
  id: string;
  value: string;
  type: "KEYWORD" | "ASIN" | "CATEGORY" | "AUTO";
  matchType: "EXACT" | "PHRASE" | "BROAD" | "AUTO";
  campaignId: string; campaignName: string;
  adGroupId: string;  adGroupName: string;
  status: Status; bid: number;
  spend: number; revenue: number; orders: number;
  impressions: number; clicks: number;
  ctr: number; cpc: number; cvr: number; acos: number; roas: number;
}

// ─── Filters ────────────────────────────────────────────────────────────────
interface CampaignFilters {
  search: string; programs: Program[];
  targetingType: "ALL" | "MANUAL" | "AUTO";
  status: Status | "ALL";
  intents: Intent[];  // empty = all
}
interface AdGroupFilters  { search: string; status: Status | "ALL"; }
interface TargetingFilters {
  search: string;
  kind: "ALL" | "KEYWORD" | "PRODUCT_TARGET" | "AUTO";
  matchType: "ALL" | "EXACT" | "PHRASE" | "BROAD";
  status: Status | "ALL";
  bidMin: string; bidMax: string;
  acosMin: string; acosMax: string;
  spendMin: string;
}

type Level = "CAMPAIGNS" | "ADGROUPS" | "TARGETS";
type Tab   = "HIERARCHY" | "FLAT";

interface PendingMark {
  suggestionId: string;
  actionType: "PAUSE" | "ENABLE" | "SET_BID" | "BID_PCT" | "SET_BUDGET" | "BUDGET_PCT" | "ADD_NEGATIVE";
  actionValue: number | null;
}

interface LastActionMark {
  suggestionId: string;
  status: "APPLIED" | "APPROVED" | "DISMISSED" | "FAILED";
  actionType: PendingMark["actionType"];
  actionValue: number | null;
  at: string;
}

type EditorAction = "TOGGLE_STATE" | "SET_BUDGET" | "SET_BID";
interface EditorContext {
  targetType: "CAMPAIGN" | "AD_GROUP" | "KEYWORD" | "PRODUCT_TARGET";
  targetId: string;
  targetName: string;
  program?: "SP" | "SB" | "SD";
  currentState: Status;
  currentValue: number;     // budget for CAMPAIGN, bid for AD_GROUP / KEYWORD / PRODUCT_TARGET
  valueLabel: string;       // "Budget" | "Default Bid" | "Bid"
  action: EditorAction;
}

export default function Targeting360Page() {
  const { activeAccount } = useAccount();
  const accountId = activeAccount?.id ?? "";
  const currency  = activeAccount?.adsMarketplace === "IN" ? "INR" : "USD";

  const [tab, setTab] = useState<Tab>("HIERARCHY");
  const [dateRange, setDateRange] = useState("Last 7D");

  // Hierarchy nav state
  const [level, setLevel] = useState<Level>("CAMPAIGNS");
  const [selectedCampaign, setSelectedCampaign] = useState<CampaignRow | null>(null);
  const [selectedAdGroup,  setSelectedAdGroup]  = useState<AdGroupRow | null>(null);

  // Data
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [adGroups,  setAdGroups]  = useState<AdGroupRow[]>([]);
  const [targets,   setTargets]   = useState<TargetingRow[]>([]);
  const [flatRows,  setFlatRows]  = useState<FlatTarget[]>([]);
  const [flatCount, setFlatCount] = useState(0);

  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // Filters
  // Toast for inline action confirmations
  const [toast, setToast] = useState<{ msg: string; kind: "ok" | "err" } | null>(null);
  const showToast = useCallback((msg: string, kind: "ok" | "err" = "ok") => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 4500);
  }, []);

  // Edit modal state — opens when user clicks Edit/Pause/Enable on a row.
  const [editor, setEditor] = useState<EditorContext | null>(null);

  // Map of pending suggestions by targetId so each row can show a pending pill.
  const [pendingByTarget, setPendingByTarget] = useState<Record<string, PendingMark>>({});
  // Map of last APPLIED/APPROVED/DISMISSED/FAILED suggestion per target — shown
  // in the 'Last Action' column so reviewers can see what's already been acted on.
  const [lastByTarget, setLastByTarget] = useState<Record<string, LastActionMark>>({});

  const reloadPending = useCallback(async () => {
    if (!accountId) { setPendingByTarget({}); setLastByTarget({}); return; }
    try {
      const [p, r] = await Promise.all([
        fetch(`/api/suggestions?accountId=${accountId}&status=PENDING`).then((x) => x.json()),
        fetch(`/api/suggestions/recent?accountId=${accountId}`).then((x) => x.json()),
      ]);
      const pmap: Record<string, PendingMark> = {};
      for (const s of p.suggestions ?? []) {
        pmap[s.targetId] = { suggestionId: s.id, actionType: s.actionType, actionValue: s.actionValue };
      }
      setPendingByTarget(pmap);
      setLastByTarget((r.actions ?? {}) as Record<string, LastActionMark>);
    } catch { /* ignore */ }
  }, [accountId]);
  useEffect(() => { reloadPending(); }, [reloadPending, level, tab]);

  const [campFilters, setCampFilters] = useState<CampaignFilters>({ search: "", programs: ["SP","SB","SD"], targetingType: "ALL", status: "ALL", intents: [] });
  const [agFilters,   setAgFilters]   = useState<AdGroupFilters>({ search: "", status: "ALL" });
  const [tgFilters,   setTgFilters]   = useState<TargetingFilters>({
    search: "", kind: "ALL", matchType: "ALL", status: "ALL",
    bidMin: "", bidMax: "", acosMin: "", acosMax: "", spendMin: "",
  });
  // Flat tab uses its own filters (kept simple — same shape as the target-level filters).
  const [flatFilters, setFlatFilters] = useState<TargetingFilters>({
    search: "", kind: "ALL", matchType: "ALL", status: "ALL",
    bidMin: "", bidMax: "", acosMin: "", acosMax: "", spendMin: "",
  });
  const [flatPage, setFlatPage] = useState(0);
  const FLAT_PAGE_SIZE = 100;

  // ─── Loaders ──────────────────────────────────────────────────────────────
  const loadCampaigns = useCallback(async () => {
    if (!accountId) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/overview?accountId=${accountId}&dateRange=${encodeURIComponent(dateRange)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCampaigns(data.campaigns ?? []);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [accountId, dateRange]);

  const loadAdGroups = useCallback(async (campaignId: string) => {
    if (!accountId) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/adgroups?accountId=${accountId}&dateRange=${encodeURIComponent(dateRange)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAdGroups(data.adGroups ?? []);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [accountId, dateRange]);

  const loadTargets = useCallback(async (adGroupId: string) => {
    if (!accountId) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/adgroups/${adGroupId}/targeting?accountId=${accountId}&dateRange=${encodeURIComponent(dateRange)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTargets([
        ...(data.keywords ?? []),
        ...(data.productTargets ?? []),
        ...(data.autoTargets ?? []),
      ]);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [accountId, dateRange]);

  const loadFlat = useCallback(async () => {
    if (!accountId) return;
    setLoading(true); setError(null);
    try {
      const qs = new URLSearchParams({
        accountId, dateRange,
        search: flatFilters.search,
        targetType: flatFilters.kind === "KEYWORD" ? "KEYWORD"
                  : flatFilters.kind === "PRODUCT_TARGET" ? "ASIN"
                  : "ALL",
        matchType: flatFilters.matchType,
        status: flatFilters.status,
        bidMin: flatFilters.bidMin, bidMax: flatFilters.bidMax,
        acosMin: flatFilters.acosMin, acosMax: flatFilters.acosMax,
        spendMin: flatFilters.spendMin,
        page: String(flatPage),
        pageSize: String(FLAT_PAGE_SIZE),
        sortBy: "spend", sortDir: "desc",
      });
      const res = await fetch(`/api/targeting?${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setFlatRows(data.targets ?? []);
      setFlatCount(data.totalCount ?? 0);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [accountId, dateRange, flatFilters, flatPage]);

  // ─── Effects ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (tab !== "HIERARCHY") return;
    if (level === "CAMPAIGNS") loadCampaigns();
    else if (level === "ADGROUPS" && selectedCampaign) loadAdGroups(selectedCampaign.id);
    else if (level === "TARGETS"  && selectedAdGroup)  loadTargets(selectedAdGroup.id);
  }, [tab, level, selectedCampaign?.id, selectedAdGroup?.id, dateRange, loadCampaigns, loadAdGroups, loadTargets]);

  useEffect(() => { if (tab === "FLAT") loadFlat(); }, [tab, loadFlat]);

  // ─── Navigation helpers ───────────────────────────────────────────────────
  const drillIntoCampaign = (c: CampaignRow) => { setSelectedCampaign(c); setSelectedAdGroup(null); setLevel("ADGROUPS"); };
  const drillIntoAdGroup  = (ag: AdGroupRow) => { setSelectedAdGroup(ag); setLevel("TARGETS"); };
  const backToCampaigns   = () => { setSelectedCampaign(null); setSelectedAdGroup(null); setLevel("CAMPAIGNS"); };
  const backToAdGroups    = () => { setSelectedAdGroup(null); setLevel("ADGROUPS"); };

  // ─── Filtering ────────────────────────────────────────────────────────────
  const filteredCampaigns = useMemo(() => campaigns.filter((c) => {
    if (campFilters.search && !c.name.toLowerCase().includes(campFilters.search.toLowerCase())) return false;
    if (!campFilters.programs.includes(c.type)) return false;
    if (campFilters.targetingType !== "ALL") {
      if (c.type !== "SP") return false;
      if (c.targetingType !== campFilters.targetingType) return false;
    }
    if (campFilters.status !== "ALL" && c.status !== campFilters.status) return false;
    if (campFilters.intents.length > 0 && !campFilters.intents.includes(c.intent)) return false;
    return true;
  }).sort((a, b) => b.spend - a.spend), [campaigns, campFilters]);

  const filteredAdGroups = useMemo(() => adGroups.filter((a) => {
    if (agFilters.search && !a.name.toLowerCase().includes(agFilters.search.toLowerCase())) return false;
    if (agFilters.status !== "ALL" && a.status !== agFilters.status) return false;
    return true;
  }).sort((a, b) => b.spend - a.spend), [adGroups, agFilters]);

  const filteredTargets = useMemo(() => targets.filter((t) => {
    if (tgFilters.search && !t.display.toLowerCase().includes(tgFilters.search.toLowerCase())) return false;
    if (tgFilters.kind !== "ALL" && t.kind !== tgFilters.kind) return false;
    if (tgFilters.matchType !== "ALL" && t.matchType !== tgFilters.matchType) return false;
    if (tgFilters.status !== "ALL" && t.state !== tgFilters.status) return false;
    const bidMin  = parseFloat(tgFilters.bidMin);  if (!isNaN(bidMin)  && t.bid  < bidMin)  return false;
    const bidMax  = parseFloat(tgFilters.bidMax);  if (!isNaN(bidMax)  && t.bid  > bidMax)  return false;
    const acosMin = parseFloat(tgFilters.acosMin); if (!isNaN(acosMin) && t.acos < acosMin) return false;
    const acosMax = parseFloat(tgFilters.acosMax); if (!isNaN(acosMax) && t.acos > acosMax) return false;
    const spdMin  = parseFloat(tgFilters.spendMin);if (!isNaN(spdMin)  && t.spend < spdMin) return false;
    return true;
  }).sort((a, b) => b.spend - a.spend), [targets, tgFilters]);

  // KPI strip for current view
  const currentTotals = useMemo(() => {
    let rows: { spend: number; sales: number; orders: number }[] = [];
    if (tab === "FLAT") {
      rows = flatRows.map((r) => ({ spend: r.spend, sales: r.revenue, orders: r.orders }));
    } else if (level === "CAMPAIGNS") {
      rows = filteredCampaigns;
    } else if (level === "ADGROUPS") {
      rows = filteredAdGroups;
    } else {
      rows = filteredTargets;
    }
    const t = rows.reduce((a, r) => ({ spend: a.spend + r.spend, sales: a.sales + r.sales, orders: a.orders + r.orders }), { spend: 0, sales: 0, orders: 0 });
    return {
      ...t,
      roas: t.spend > 0 ? t.sales / t.spend : 0,
      acos: t.sales > 0 ? (t.spend / t.sales) * 100 : 0,
      count: tab === "FLAT" ? flatCount : rows.length,
    };
  }, [tab, level, filteredCampaigns, filteredAdGroups, filteredTargets, flatRows, flatCount]);

  return (
    <div style={{ minHeight: "100vh", background: "#0d1117" }}>
      <TopNav />
      <main style={{ padding: "24px 28px", maxWidth: 1600, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: "#e2e8f0" }}>Targeting 360</h1>
            {tab === "HIERARCHY" ? (
              <div style={{ fontSize: 11, color: "#8892a4", marginTop: 4 }}>
                <button onClick={backToCampaigns} style={crumbBtn(level === "CAMPAIGNS")}>
                  {activeAccount?.name ?? "Account"} · Campaigns
                </button>
                {selectedCampaign && (
                  <>
                    <span style={crumbSep}>›</span>
                    <button onClick={backToAdGroups} style={crumbBtn(level === "ADGROUPS")} title={selectedCampaign.name}>
                      {selectedCampaign.name.length > 50 ? selectedCampaign.name.slice(0, 50) + "…" : selectedCampaign.name}
                    </button>
                  </>
                )}
                {selectedAdGroup && (
                  <>
                    <span style={crumbSep}>›</span>
                    <span style={crumbBtn(true)} title={selectedAdGroup.name}>
                      {selectedAdGroup.name.length > 40 ? selectedAdGroup.name.slice(0, 40) + "…" : selectedAdGroup.name}
                    </span>
                  </>
                )}
              </div>
            ) : (
              <div style={{ fontSize: 11, color: "#8892a4", marginTop: 4 }}>{activeAccount?.name ?? "Account"} · all keywords + product targets</div>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <DateRangePicker value={dateRange} onChange={setDateRange} compareValue="prev-period" onCompareChange={() => {}} showCompare={false} />
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
          <button onClick={() => setTab("HIERARCHY")} style={tabBtn(tab === "HIERARCHY")}>Hierarchy</button>
          <button onClick={() => setTab("FLAT")}      style={tabBtn(tab === "FLAT")}>All Keywords</button>
        </div>

        {/* KPI strip */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12, marginBottom: 12 }}>
          <Tile label={
            tab === "FLAT" ? "Targets" :
            level === "CAMPAIGNS" ? "Campaigns" :
            level === "ADGROUPS" ? "Ad Groups" : "Targets"
          } value={`${currentTotals.count.toLocaleString()}`} />
          <Tile label="Spend"  value={fmt(currentTotals.spend, "currency", currency)} />
          <Tile label="Sales"  value={fmt(currentTotals.sales, "currency", currency)} />
          <Tile label="ROAS"   value={`${currentTotals.roas.toFixed(2)}x`} />
          <Tile label="ACOS"   value={`${currentTotals.acos.toFixed(1)}%`} />
        </div>

        {!accountId && (
          <div style={{ background: "#161b27", border: "1px solid #2a3245", padding: 16, borderRadius: 8, fontSize: 13, color: "#8892a4" }}>
            Pick a brand from the top-right dropdown.
          </div>
        )}

        {error && (
          <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#ef4444" }}>
            ⚠ {error}
          </div>
        )}

        {/* Body */}
        {accountId && tab === "HIERARCHY" && level === "CAMPAIGNS" && (
          <CampaignsView filters={campFilters} setFilters={setCampFilters} rows={filteredCampaigns} loading={loading} currency={currency} onDrill={drillIntoCampaign}
            pending={pendingByTarget} last={lastByTarget} openEditor={setEditor} />
        )}
        {accountId && tab === "HIERARCHY" && level === "ADGROUPS" && (
          <AdGroupsView  filters={agFilters}   setFilters={setAgFilters}   rows={filteredAdGroups}   loading={loading} currency={currency} onDrill={drillIntoAdGroup}
            pending={pendingByTarget} last={lastByTarget} openEditor={setEditor} />
        )}
        {accountId && tab === "HIERARCHY" && level === "TARGETS" && (
          <TargetsView   filters={tgFilters}   setFilters={setTgFilters}   rows={filteredTargets}    loading={loading} currency={currency}
            pending={pendingByTarget} last={lastByTarget} openEditor={setEditor} />
        )}
        {accountId && tab === "FLAT" && (
          <FlatView filters={flatFilters} setFilters={(f) => { setFlatPage(0); setFlatFilters(f); }} rows={flatRows} totalCount={flatCount} loading={loading} currency={currency} page={flatPage} setPage={setFlatPage} pageSize={FLAT_PAGE_SIZE}
            pending={pendingByTarget} last={lastByTarget} openEditor={setEditor} />
        )}

        {/* Inline editor modal */}
        {editor && (
          <EditorModal
            ctx={editor}
            currency={currency}
            onClose={() => setEditor(null)}
            onResult={async (msg, kind) => {
              setEditor(null);
              showToast(msg, kind);
              await reloadPending();
            }}
            accountId={accountId}
          />
        )}

        {/* Toast */}
        {toast && (
          <div style={{
            position: "fixed", bottom: 20, right: 20, zIndex: 100,
            padding: "12px 18px", borderRadius: 8, fontSize: 12,
            background: toast.kind === "ok" ? "rgba(34,197,94,0.18)" : "rgba(239,68,68,0.18)",
            border: `1px solid ${toast.kind === "ok" ? "#22c55e" : "#ef4444"}`,
            color: toast.kind === "ok" ? "#86efac" : "#ef4444",
            maxWidth: 380, lineHeight: 1.4,
          }}>{toast.msg}</div>
        )}
      </main>
    </div>
  );
}

// ─── Editor modal ────────────────────────────────────────────────────────────

function EditorModal({ ctx, currency, accountId, onClose, onResult }: {
  ctx: EditorContext;
  currency: string;
  accountId: string;
  onClose: () => void;
  onResult: (msg: string, kind: "ok" | "err") => void;
}) {
  const isToggle = ctx.action === "TOGGLE_STATE";
  const newState: Status = ctx.currentState === "ENABLED" ? "PAUSED" : "ENABLED";

  const [value, setValue] = useState<string>(isToggle ? "" : String(ctx.currentValue));
  const [busy, setBusy] = useState<"" | "QUEUE" | "APPLY">("");

  const submit = async (apply: boolean) => {
    setBusy(apply ? "APPLY" : "QUEUE");
    try {
      let actionType: "PAUSE" | "ENABLE" | "SET_BID" | "SET_BUDGET";
      let actionValue: number | undefined;

      if (isToggle) {
        actionType = newState === "ENABLED" ? "ENABLE" : "PAUSE";
      } else {
        const n = parseFloat(value);
        if (isNaN(n) || n <= 0) {
          setBusy("");
          alert("Enter a positive number");
          return;
        }
        actionType  = ctx.action === "SET_BUDGET" ? "SET_BUDGET" : "SET_BID";
        actionValue = n;
      }

      const res = await queueSuggestion({
        accountId,
        targetType: ctx.targetType,
        targetId: ctx.targetId,
        targetName: ctx.targetName,
        program: ctx.program,
        actionType,
        actionValue,
        currentValue: ctx.currentValue,
        apply,
      });

      if (apply) {
        if (res.applied) {
          onResult(`✓ Pushed to Amazon: ${ctx.targetName.slice(0, 60)}`, "ok");
        } else {
          onResult(`⚠ Amazon rejected: ${res.message ?? "see /suggestions"}`, "err");
        }
      } else {
        onResult(`Queued for review. Open Suggestions to approve and push to Amazon.`, "ok");
      }
    } catch (e) {
      onResult(`Failed: ${String(e)}`, "err");
    } finally {
      setBusy("");
    }
  };

  const title =
    ctx.action === "TOGGLE_STATE" ? `${newState === "ENABLED" ? "Enable" : "Pause"} ${prettyType(ctx.targetType)}`
    : `Edit ${ctx.valueLabel.toLowerCase()}`;

  return (
    <div style={modalBackdrop} onClick={onClose}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0", marginBottom: 6 }}>{title}</div>
        <div style={{ fontSize: 11, color: "#8892a4", marginBottom: 14 }}>{prettyType(ctx.targetType)}: {ctx.targetName}</div>

        {!isToggle && (
          <>
            <div style={{ fontSize: 11, color: "#8892a4", marginBottom: 4 }}>Current {ctx.valueLabel.toLowerCase()}: <strong style={{ color: "#e2e8f0" }}>{fmt(ctx.currentValue, "currency", currency)}</strong></div>
            <input
              type="number" step="0.01" min="0.02"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
              style={{ ...inputStyle, width: "100%", fontSize: 14, padding: "8px 12px", marginBottom: 12 }}
            />
          </>
        )}
        {isToggle && (
          <div style={{ fontSize: 12, color: "#a5b4fc", marginBottom: 14, padding: "8px 12px", background: "rgba(99,102,241,0.10)", borderRadius: 6 }}>
            Will change state from <strong>{ctx.currentState}</strong> → <strong>{newState}</strong>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
          <button onClick={onClose} disabled={!!busy} style={modalCancelBtn}>Cancel</button>
          <button onClick={() => submit(false)} disabled={!!busy} style={modalSecondaryBtn} title="Add to /suggestions for review">
            {busy === "QUEUE" ? "Queueing…" : "Queue for review"}
          </button>
          <button onClick={() => submit(true)}  disabled={!!busy} style={modalPrimaryBtn} title="Push directly to Amazon now">
            {busy === "APPLY" ? "Applying…" : "Apply to Amazon now"}
          </button>
        </div>
        <div style={{ fontSize: 10, color: "#555f6e", marginTop: 10, textAlign: "right" }}>
          Queue = add as PENDING in /suggestions · Apply = push to Amazon immediately
        </div>
      </div>
    </div>
  );
}

function prettyType(t: "CAMPAIGN" | "AD_GROUP" | "KEYWORD" | "PRODUCT_TARGET"): string {
  return t === "CAMPAIGN" ? "campaign" : t === "AD_GROUP" ? "ad group" : t === "KEYWORD" ? "keyword" : "product target";
}

const modalBackdrop: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 200,
  display: "flex", alignItems: "center", justifyContent: "center",
};
const modalCard: React.CSSProperties = {
  background: "#161b27", border: "1px solid #2a3245", borderRadius: 10,
  padding: 20, width: 440, maxWidth: "90vw",
};
const modalCancelBtn: React.CSSProperties = {
  padding: "6px 12px", borderRadius: 6, background: "transparent",
  border: "1px solid #2a3245", color: "#8892a4", fontSize: 12, cursor: "pointer",
};
const modalSecondaryBtn: React.CSSProperties = {
  padding: "6px 14px", borderRadius: 6, background: "#1c2333",
  border: "1px solid #2a3245", color: "#a5b4fc", fontSize: 12, fontWeight: 600, cursor: "pointer",
};
const modalPrimaryBtn: React.CSSProperties = {
  padding: "6px 14px", borderRadius: 6,
  background: "linear-gradient(135deg,#6366f1,#8b5cf6)",
  border: "1px solid transparent",
  color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer",
};

// ─── Hierarchy: Campaigns view ───────────────────────────────────────────────

function CampaignsView({ filters, setFilters, rows, loading, currency, onDrill, pending, last, openEditor }: {
  filters: CampaignFilters; setFilters: (f: CampaignFilters) => void;
  rows: CampaignRow[]; loading: boolean; currency: string;
  onDrill: (c: CampaignRow) => void;
  pending: Record<string, PendingMark>;
  last: Record<string, LastActionMark>;
  openEditor: (ctx: EditorContext) => void;
}) {
  const toggleProgram = (p: Program) => {
    const next = filters.programs.includes(p) ? filters.programs.filter((x) => x !== p) : [...filters.programs, p];
    setFilters({ ...filters, programs: next });
  };
  const toggleIntent = (i: Intent) => {
    const next = filters.intents.includes(i) ? filters.intents.filter((x) => x !== i) : [...filters.intents, i];
    setFilters({ ...filters, intents: next });
  };
  return (
    <>
      <FilterBar>
        <input value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          placeholder="Search campaign name…" style={{ ...inputStyle, flex: 1, minWidth: 200 }} />
        <div style={{ display: "flex", gap: 4 }}>
          {(["SP","SB","SD"] as Program[]).map((p) => (
            <button key={p} onClick={() => toggleProgram(p)} style={chipStyleOn(filters.programs.includes(p))}>{p}</button>
          ))}
        </div>
        <select value={filters.targetingType} onChange={(e) => setFilters({ ...filters, targetingType: e.target.value as CampaignFilters["targetingType"] })} style={inputStyle}>
          <option value="ALL">All targeting</option>
          <option value="MANUAL">Manual (SP)</option>
          <option value="AUTO">Auto (SP)</option>
        </select>
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value as CampaignFilters["status"] })} style={inputStyle}>
          <option value="ALL">All states</option>
          <option value="ENABLED">Enabled</option>
          <option value="PAUSED">Paused</option>
          <option value="ARCHIVED">Archived</option>
        </select>
      </FilterBar>
      <FilterBar>
        <span style={{ fontSize: 11, color: "#8892a4", alignSelf: "center" }}>Intent:</span>
        {(["BRANDED","GENERIC","COMPETITION","AUTO","PAT","OTHER"] as Intent[]).map((i) => (
          <button key={i} onClick={() => toggleIntent(i)} style={{
            ...chipStyleOn(filters.intents.includes(i)),
            background: filters.intents.includes(i) ? intentChipColor(i).bg : "#1c2333",
            color:      filters.intents.includes(i) ? intentChipColor(i).fg : "#8892a4",
            borderColor: filters.intents.includes(i) ? intentChipColor(i).fg : "#2a3245",
          }}>
            {intentLabelShort(i)}
          </button>
        ))}
      </FilterBar>
      <TableShell loading={loading}>
        <table style={tableStyle}>
          <thead>
            <tr style={tableHeadRow}>
              <Th>Type</Th><Th>Intent</Th><Th>Targeting</Th><Th>Status</Th><Th align="left">Campaign</Th>
              <Th align="right">Budget</Th><Th align="right">Spend</Th><Th align="right">Sales</Th>
              <Th align="right">Orders</Th><Th align="right">ROAS</Th><Th align="right">ACOS</Th><Th align="right">CTR</Th>
              <Th align="left">Last Action</Th>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} style={tableRow}>
                <Td onClick={() => onDrill(c)} style={{ cursor: "pointer" }}><Pill text={c.type} /></Td>
                <Td onClick={() => onDrill(c)} style={{ cursor: "pointer" }}><IntentChip intent={c.intent} /></Td>
                <Td onClick={() => onDrill(c)} style={{ cursor: "pointer" }}>{c.type === "SP" && c.targetingType ? <Pill text={c.targetingType} /> : <span style={{ color: "#555f6e" }}>—</span>}</Td>
                <Td onClick={() => onDrill(c)} style={{ cursor: "pointer" }}><Pill text={c.status} muted={c.status !== "ENABLED"} /></Td>
                <Td onClick={() => onDrill(c)} title={c.name} style={{ ...cellNameStyle, cursor: "pointer" }}>{c.name}</Td>
                <Td align="right" style={{ color: "#8892a4" }}>{fmt(c.budget, "currency", currency)}</Td>
                <Td align="right" style={{ color: "#e2e8f0" }}>{fmt(c.spend, "currency", currency)}</Td>
                <Td align="right" style={{ color: "#e2e8f0" }}>{fmt(c.sales, "currency", currency)}</Td>
                <Td align="right" style={{ color: "#8892a4" }}>{c.orders}</Td>
                <Td align="right" style={{ color: roasColor(c.roas) }}>{c.roas.toFixed(2)}x</Td>
                <Td align="right" style={{ color: acosColor(c.acos) }}>{c.acos.toFixed(1)}%</Td>
                <Td align="right" style={{ color: "#8892a4" }}>{c.ctr.toFixed(2)}%</Td>
                <Td><LastActionPill mark={last[c.id]} currency={currency} /></Td>
                <Td align="right">
                  <RowActions
                    state={c.status}
                    pending={pending[c.id]} currency={currency}
                    onToggle={() => openEditor({
                      targetType: "CAMPAIGN", targetId: c.id, targetName: c.name, program: c.type,
                      currentState: c.status, currentValue: c.budget, valueLabel: "Budget", action: "TOGGLE_STATE",
                    })}
                    onEdit={() => openEditor({
                      targetType: "CAMPAIGN", targetId: c.id, targetName: c.name, program: c.type,
                      currentState: c.status, currentValue: c.budget, valueLabel: "Budget", action: "SET_BUDGET",
                    })}
                    editLabel="Edit budget"
                  />
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && !loading && <Empty msg="No campaigns match the filters." />}
      </TableShell>
    </>
  );
}

// ─── Hierarchy: Ad Groups view ───────────────────────────────────────────────

function AdGroupsView({ filters, setFilters, rows, loading, currency, onDrill, pending, last, openEditor }: {
  filters: AdGroupFilters; setFilters: (f: AdGroupFilters) => void;
  rows: AdGroupRow[]; loading: boolean; currency: string;
  onDrill: (a: AdGroupRow) => void;
  pending: Record<string, PendingMark>;
  last: Record<string, LastActionMark>;
  openEditor: (ctx: EditorContext) => void;
}) {
  return (
    <>
      <FilterBar>
        <input value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          placeholder="Search ad-group name…" style={{ ...inputStyle, flex: 1, minWidth: 200 }} />
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value as AdGroupFilters["status"] })} style={inputStyle}>
          <option value="ALL">All states</option>
          <option value="ENABLED">Enabled</option>
          <option value="PAUSED">Paused</option>
          <option value="ARCHIVED">Archived</option>
        </select>
      </FilterBar>
      <TableShell loading={loading}>
        <table style={tableStyle}>
          <thead>
            <tr style={tableHeadRow}>
              <Th>Type</Th><Th>Status</Th><Th align="left">Ad Group</Th>
              <Th align="right">Default Bid</Th><Th align="right">Spend</Th><Th align="right">Sales</Th>
              <Th align="right">Orders</Th><Th align="right">ROAS</Th><Th align="right">ACOS</Th><Th align="right">CTR</Th>
              <Th align="left">Last Action</Th>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((ag) => (
              <tr key={ag.id} style={tableRow}>
                <Td onClick={() => onDrill(ag)} style={{ cursor: "pointer" }}><Pill text={ag.type} /></Td>
                <Td onClick={() => onDrill(ag)} style={{ cursor: "pointer" }}><Pill text={ag.status} muted={ag.status !== "ENABLED"} /></Td>
                <Td onClick={() => onDrill(ag)} title={ag.name} style={{ ...cellNameStyle, cursor: "pointer" }}>{ag.name}</Td>
                <Td align="right" style={{ color: "#8892a4" }}>{fmt(ag.defaultBid, "currency", currency)}</Td>
                <Td align="right" style={{ color: "#e2e8f0" }}>{fmt(ag.spend, "currency", currency)}</Td>
                <Td align="right" style={{ color: "#e2e8f0" }}>{fmt(ag.sales, "currency", currency)}</Td>
                <Td align="right" style={{ color: "#8892a4" }}>{ag.orders}</Td>
                <Td align="right" style={{ color: roasColor(ag.roas) }}>{ag.roas.toFixed(2)}x</Td>
                <Td align="right" style={{ color: acosColor(ag.acos) }}>{ag.acos.toFixed(1)}%</Td>
                <Td align="right" style={{ color: "#8892a4" }}>{ag.ctr.toFixed(2)}%</Td>
                <Td><LastActionPill mark={last[ag.id]} currency={currency} /></Td>
                <Td align="right">
                  <RowActions
                    state={ag.status}
                    pending={pending[ag.id]} currency={currency}
                    onToggle={() => openEditor({
                      targetType: "AD_GROUP", targetId: ag.id, targetName: ag.name, program: ag.type,
                      currentState: ag.status, currentValue: ag.defaultBid, valueLabel: "Default Bid", action: "TOGGLE_STATE",
                    })}
                    onEdit={() => openEditor({
                      targetType: "AD_GROUP", targetId: ag.id, targetName: ag.name, program: ag.type,
                      currentState: ag.status, currentValue: ag.defaultBid, valueLabel: "Default Bid", action: "SET_BID",
                    })}
                    editLabel="Edit bid"
                  />
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && !loading && <Empty msg="No ad groups match the filters." />}
      </TableShell>
    </>
  );
}

// ─── Hierarchy: Targets view ─────────────────────────────────────────────────

function TargetsView({ filters, setFilters, rows, loading, currency, pending, last, openEditor }: {
  filters: TargetingFilters; setFilters: (f: TargetingFilters) => void;
  rows: TargetingRow[]; loading: boolean; currency: string;
  pending: Record<string, PendingMark>;
  last: Record<string, LastActionMark>;
  openEditor: (ctx: EditorContext) => void;
}) {
  return (
    <>
      <TargetingFilterBar filters={filters} setFilters={setFilters} />
      <TableShell loading={loading}>
        <table style={tableStyle}>
          <thead>
            <tr style={tableHeadRow}>
              <Th>Kind</Th><Th>Match</Th><Th>State</Th><Th align="left">Keyword / Target</Th>
              <Th align="right">Bid</Th><Th align="right">Spend</Th><Th align="right">Sales</Th>
              <Th align="right">Orders</Th><Th align="right">ROAS</Th><Th align="right">ACOS</Th>
              <Th align="right">CTR</Th><Th align="right">CPC</Th><Th align="right">CVR</Th>
              <Th align="left">Last Action</Th>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} style={tableRow}>
                <Td><Pill text={t.kind === "KEYWORD" ? "KW" : t.kind === "AUTO" ? "AUTO" : "PT"} /></Td>
                <Td>{t.matchType ? <Pill text={t.matchType} /> : <span style={{ color: "#555f6e" }}>—</span>}</Td>
                <Td><Pill text={t.state} muted={t.state !== "ENABLED"} /></Td>
                <Td title={t.display} style={cellNameStyle}>{t.display}</Td>
                <Td align="right" style={{ color: "#8892a4" }}>{fmt(t.bid, "currency", currency)}</Td>
                <Td align="right" style={{ color: "#e2e8f0" }}>{fmt(t.spend, "currency", currency)}</Td>
                <Td align="right" style={{ color: "#e2e8f0" }}>{fmt(t.sales, "currency", currency)}</Td>
                <Td align="right" style={{ color: "#8892a4" }}>{t.orders}</Td>
                <Td align="right" style={{ color: roasColor(t.roas) }}>{t.roas.toFixed(2)}x</Td>
                <Td align="right" style={{ color: acosColor(t.acos) }}>{t.acos.toFixed(1)}%</Td>
                <Td align="right" style={{ color: "#8892a4" }}>{t.ctr.toFixed(2)}%</Td>
                <Td align="right" style={{ color: "#8892a4" }}>{fmt(t.cpc, "currency", currency)}</Td>
                <Td align="right" style={{ color: "#8892a4" }}>{t.cvr.toFixed(2)}%</Td>
                <Td><LastActionPill mark={last[t.id]} currency={currency} /></Td>
                <Td align="right">
                  <RowActions
                    state={t.state}
                    pending={pending[t.id]} currency={currency}
                    onToggle={() => openEditor({
                      targetType: t.kind === "AUTO" ? "PRODUCT_TARGET" : t.kind, targetId: t.id, targetName: t.display, program: "SP",
                      currentState: t.state, currentValue: t.bid, valueLabel: "Bid", action: "TOGGLE_STATE",
                    })}
                    onEdit={() => openEditor({
                      targetType: t.kind === "AUTO" ? "PRODUCT_TARGET" : t.kind, targetId: t.id, targetName: t.display, program: "SP",
                      currentState: t.state, currentValue: t.bid, valueLabel: "Bid", action: "SET_BID",
                    })}
                    editLabel="Edit bid"
                  />
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && !loading && <Empty msg="No keywords/targets match the filters." />}
      </TableShell>
    </>
  );
}

// ─── Flat tab: All Keywords + product targets ────────────────────────────────

function FlatView({ filters, setFilters, rows, totalCount, loading, currency, page, setPage, pageSize, pending, last, openEditor }: {
  filters: TargetingFilters; setFilters: (f: TargetingFilters) => void;
  rows: FlatTarget[]; totalCount: number;
  loading: boolean; currency: string;
  page: number; setPage: (p: number) => void;
  pageSize: number;
  pending: Record<string, PendingMark>;
  last: Record<string, LastActionMark>;
  openEditor: (ctx: EditorContext) => void;
}) {
  const pages = Math.max(1, Math.ceil(totalCount / pageSize));
  return (
    <>
      <TargetingFilterBar filters={filters} setFilters={setFilters} />
      <TableShell loading={loading}>
        <table style={tableStyle}>
          <thead>
            <tr style={tableHeadRow}>
              <Th>Kind</Th><Th>Match</Th><Th>State</Th>
              <Th align="left">Keyword / Target</Th>
              <Th align="left">Campaign</Th><Th align="left">Ad Group</Th>
              <Th align="right">Bid</Th><Th align="right">Spend</Th><Th align="right">Sales</Th>
              <Th align="right">Orders</Th><Th align="right">ROAS</Th><Th align="right">ACOS</Th>
              <Th align="left">Last Action</Th>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} style={tableRow}>
                <Td><Pill text={t.type === "KEYWORD" ? "KW" : "PT"} /></Td>
                <Td><Pill text={t.matchType} /></Td>
                <Td><Pill text={t.status} muted={t.status !== "ENABLED"} /></Td>
                <Td title={t.value} style={cellNameStyle}>{t.value}</Td>
                <Td title={t.campaignName} style={{ ...cellNameStyle, maxWidth: 200, color: "#8892a4" }}>{t.campaignName}</Td>
                <Td title={t.adGroupName} style={{ ...cellNameStyle, maxWidth: 180, color: "#8892a4" }}>{t.adGroupName}</Td>
                <Td align="right" style={{ color: "#8892a4" }}>{fmt(t.bid, "currency", currency)}</Td>
                <Td align="right" style={{ color: "#e2e8f0" }}>{fmt(t.spend, "currency", currency)}</Td>
                <Td align="right" style={{ color: "#e2e8f0" }}>{fmt(t.revenue, "currency", currency)}</Td>
                <Td align="right" style={{ color: "#8892a4" }}>{t.orders}</Td>
                <Td align="right" style={{ color: roasColor(t.roas) }}>{t.roas.toFixed(2)}x</Td>
                <Td align="right" style={{ color: acosColor(t.acos) }}>{t.acos.toFixed(1)}%</Td>
                <Td><LastActionPill mark={last[t.id]} currency={currency} /></Td>
                <Td align="right">
                  <RowActions
                    state={t.status}
                    pending={pending[t.id]} currency={currency}
                    onToggle={() => openEditor({
                      targetType: t.type === "KEYWORD" ? "KEYWORD" : "PRODUCT_TARGET",
                      targetId: t.id, targetName: t.value, program: "SP",
                      currentState: t.status, currentValue: t.bid, valueLabel: "Bid", action: "TOGGLE_STATE",
                    })}
                    onEdit={() => openEditor({
                      targetType: t.type === "KEYWORD" ? "KEYWORD" : "PRODUCT_TARGET",
                      targetId: t.id, targetName: t.value, program: "SP",
                      currentState: t.status, currentValue: t.bid, valueLabel: "Bid", action: "SET_BID",
                    })}
                    editLabel="Edit bid"
                  />
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && !loading && <Empty msg="No keywords/targets match the filters." />}
        {pages > 1 && (
          <div style={{ padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, color: "#8892a4" }}>
            <span>{(page * pageSize) + 1}–{Math.min((page + 1) * pageSize, totalCount)} of {totalCount.toLocaleString()}</span>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} style={pagerBtn(page === 0)}>‹ Prev</button>
              <button onClick={() => setPage(Math.min(pages - 1, page + 1))} disabled={page >= pages - 1} style={pagerBtn(page >= pages - 1)}>Next ›</button>
            </div>
          </div>
        )}
      </TableShell>
    </>
  );
}

// ─── Shared filter bar for targeting (used by hierarchy targets + flat) ─────

function TargetingFilterBar({ filters, setFilters }: { filters: TargetingFilters; setFilters: (f: TargetingFilters) => void }) {
  return (
    <>
      <FilterBar>
        <input value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          placeholder="Search keyword/target…" style={{ ...inputStyle, flex: 1, minWidth: 180 }} />
        <select value={filters.kind} onChange={(e) => setFilters({ ...filters, kind: e.target.value as TargetingFilters["kind"] })} style={inputStyle}>
          <option value="ALL">All kinds</option>
          <option value="KEYWORD">Keywords</option>
          <option value="PRODUCT_TARGET">Product Targets</option>
          <option value="AUTO">Auto Targets</option>
        </select>
        <select value={filters.matchType} onChange={(e) => setFilters({ ...filters, matchType: e.target.value as TargetingFilters["matchType"] })} style={inputStyle}>
          <option value="ALL">All matches</option>
          <option value="EXACT">Exact</option>
          <option value="PHRASE">Phrase</option>
          <option value="BROAD">Broad</option>
        </select>
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value as TargetingFilters["status"] })} style={inputStyle}>
          <option value="ALL">All states</option>
          <option value="ENABLED">Enabled</option>
          <option value="PAUSED">Paused</option>
        </select>
      </FilterBar>
      <FilterBar>
        <RangeFilter label="Bid"   min={filters.bidMin}  max={filters.bidMax}
          onMin={(v) => setFilters({ ...filters, bidMin:  v })} onMax={(v) => setFilters({ ...filters, bidMax: v })} />
        <RangeFilter label="ACOS%" min={filters.acosMin} max={filters.acosMax}
          onMin={(v) => setFilters({ ...filters, acosMin: v })} onMax={(v) => setFilters({ ...filters, acosMax: v })} />
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <label style={{ fontSize: 11, color: "#8892a4" }}>Spend ≥</label>
          <input value={filters.spendMin} onChange={(e) => setFilters({ ...filters, spendMin: e.target.value })} type="number" style={{ ...inputStyle, width: 90 }} />
        </div>
      </FilterBar>
    </>
  );
}

// ─── Reusable bits ──────────────────────────────────────────────────────────

function FilterBar({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>{children}</div>;
}
function TableShell({ children, loading }: { children: React.ReactNode; loading: boolean }) {
  return (
    <div style={{ background: "#161b27", border: "1px solid #2a3245", borderRadius: 10, padding: 4 }}>
      {loading
        ? <div style={{ padding: 24, textAlign: "center", color: "#8892a4", fontSize: 12 }}>Loading…</div>
        : <div style={{ overflowX: "auto" }}>{children}</div>}
    </div>
  );
}
function Empty({ msg }: { msg: string }) {
  return <div style={{ padding: 24, textAlign: "center", color: "#555f6e", fontSize: 12 }}>{msg}</div>;
}
function RangeFilter({ label, min, max, onMin, onMax }: {
  label: string; min: string; max: string; onMin: (v: string) => void; onMax: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      <label style={{ fontSize: 11, color: "#8892a4" }}>{label}</label>
      <input value={min} onChange={(e) => onMin(e.target.value)} placeholder="min" type="number" style={{ ...inputStyle, width: 60 }} />
      <span style={{ color: "#555f6e" }}>–</span>
      <input value={max} onChange={(e) => onMax(e.target.value)} placeholder="max" type="number" style={{ ...inputStyle, width: 60 }} />
    </div>
  );
}
function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "#161b27", border: "1px solid #2a3245", borderRadius: 10, padding: "12px 14px" }}>
      <div style={{ fontSize: 10, color: "#8892a4", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: "#e2e8f0", marginTop: 4 }}>{value}</div>
    </div>
  );
}
function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <th style={{ textAlign: align, padding: "8px 6px", fontWeight: 500, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", color: "#8892a4" }}>{children}</th>;
}
function Td({ children, align = "left", style, title, onClick }: { children: React.ReactNode; align?: "left" | "right"; style?: React.CSSProperties; title?: string; onClick?: () => void }) {
  return <td onClick={onClick} style={{ textAlign: align, padding: "10px 6px", ...style }} title={title}>{children}</td>;
}
function RowActions({ state, pending, currency, onToggle, onEdit, editLabel }: {
  state: Status;
  pending?: PendingMark;
  currency: string;
  onToggle: () => void;
  onEdit: () => void;
  editLabel: string;
}) {
  const pauseEnable = state === "ENABLED" ? "Pause" : "Enable";
  return (
    <div style={{ display: "inline-flex", gap: 6, justifyContent: "flex-end", alignItems: "center" }} onClick={(e) => e.stopPropagation()}>
      {pending && <PendingPill mark={pending} currency={currency} />}
      <button onClick={onToggle} style={miniBtn} title={`Open ${pauseEnable.toLowerCase()} dialog`}>
        {pauseEnable}
      </button>
      <button onClick={onEdit} style={miniBtn} title={editLabel}>
        ✎ {editLabel.split(" ")[1]}
      </button>
    </div>
  );
}

function LastActionPill({ mark, currency }: { mark?: LastActionMark; currency: string }) {
  if (!mark) return <span style={{ color: "#555f6e", fontSize: 11 }}>—</span>;
  const { actionType, actionValue, status, at } = mark;
  // Color by status
  const palette: Record<LastActionMark["status"], { bg: string; fg: string; border: string; icon: string }> = {
    APPLIED:   { bg: "rgba(34,197,94,0.12)",  fg: "#86efac", border: "#22c55e", icon: "✓" },
    APPROVED:  { bg: "rgba(99,102,241,0.12)", fg: "#a5b4fc", border: "#6366f1", icon: "📋" },
    DISMISSED: { bg: "rgba(85,95,110,0.18)",  fg: "#8892a4", border: "#3a4560", icon: "✕" },
    FAILED:    { bg: "rgba(239,68,68,0.12)",  fg: "#ef4444", border: "#ef4444", icon: "⚠" },
  };
  const c = palette[status];
  let action = actionType.replace("_", " ").toLowerCase();
  if (actionValue != null && (actionType === "SET_BID" || actionType === "SET_BUDGET")) {
    action = `${action.replace("set ", "→ ")} ${fmt(actionValue, "currency", currency)}`;
  }
  return (
    <a href="/suggestions" title={`${status} at ${at}`} style={{
      padding: "2px 6px", borderRadius: 4, fontSize: 10, fontWeight: 600,
      background: c.bg, color: c.fg, border: `1px solid ${c.border}`,
      textDecoration: "none", display: "inline-block",
    }}>{c.icon} {action} · {timeAgo(at)}</a>
  );
}

function timeAgo(iso: string): string {
  try {
    const d = new Date(iso);
    const mins = Math.round((Date.now() - d.getTime()) / 60_000);
    if (mins < 1)     return "now";
    if (mins < 60)    return `${mins}m`;
    if (mins < 24*60) return `${Math.round(mins/60)}h`;
    return `${Math.round(mins / (24*60))}d`;
  } catch { return iso.slice(0, 10); }
}

function PendingPill({ mark, currency }: { mark: PendingMark; currency: string }) {
  let label = mark.actionType.replace("_", " ").toLowerCase();
  if (mark.actionValue != null && (mark.actionType === "SET_BID" || mark.actionType === "SET_BUDGET")) {
    label = `${label.replace("set ", "→ ")} ${fmt(mark.actionValue, "currency", currency)}`;
  }
  return (
    <a href="/suggestions" title="Pending in /suggestions — click to review" style={{
      padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600,
      background: "rgba(245,158,11,0.18)", color: "#fde68a",
      border: "1px solid #f59e0b", textDecoration: "none",
    }}>⏳ {label}</a>
  );
}

const miniBtn: React.CSSProperties = {
  padding: "3px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600,
  background: "#1c2333", border: "1px solid #2a3245",
  color: "#a5b4fc", cursor: "pointer",
};

function IntentChip({ intent }: { intent: Intent }) {
  const c = intentChipColor(intent);
  return <span style={{
    display: "inline-block", padding: "2px 6px", borderRadius: 4,
    background: c.bg, color: c.fg, fontSize: 10, fontWeight: 600,
  }}>{intentLabelShort(intent)}</span>;
}

function intentLabelShort(i: Intent): string {
  return { BRANDED: "Brand", GENERIC: "Generic", COMPETITION: "Comp", AUTO: "Auto", PAT: "PAT", OTHER: "—" }[i];
}
function intentChipColor(i: Intent): { bg: string; fg: string } {
  return {
    BRANDED:     { bg: "rgba(34,197,94,0.15)",  fg: "#86efac" },
    GENERIC:     { bg: "rgba(99,102,241,0.15)", fg: "#a5b4fc" },
    COMPETITION: { bg: "rgba(239,68,68,0.15)",  fg: "#ef4444" },
    AUTO:        { bg: "rgba(245,158,11,0.15)", fg: "#fde68a" },
    PAT:         { bg: "rgba(167,139,250,0.15)", fg: "#ddd6fe" },
    OTHER:       { bg: "rgba(85,95,110,0.20)",  fg: "#8892a4" },
  }[i];
}

function Pill({ text, muted }: { text: string; muted?: boolean }) {
  const palette: Record<string, { bg: string; fg: string }> = {
    SP:       { bg: "rgba(99,102,241,0.15)", fg: "#a5b4fc" },
    SB:       { bg: "rgba(139,92,246,0.15)", fg: "#c4b5fd" },
    SD:       { bg: "rgba(167,139,250,0.15)", fg: "#ddd6fe" },
    KW:       { bg: "rgba(99,102,241,0.15)", fg: "#a5b4fc" },
    PT:       { bg: "rgba(167,139,250,0.15)", fg: "#ddd6fe" },
    AUTO:     { bg: "rgba(245,158,11,0.15)", fg: "#fde68a" },
    MANUAL:   { bg: "rgba(34,197,94,0.12)",  fg: "#86efac" },
    EXACT:    { bg: "rgba(99,102,241,0.10)", fg: "#a5b4fc" },
    PHRASE:   { bg: "rgba(139,92,246,0.10)", fg: "#c4b5fd" },
    BROAD:    { bg: "rgba(167,139,250,0.10)", fg: "#ddd6fe" },
    ENABLED:  { bg: "rgba(34,197,94,0.15)",  fg: "#86efac" },
    PAUSED:   { bg: "rgba(245,158,11,0.15)", fg: "#fde68a" },
    ARCHIVED: { bg: "rgba(85,95,110,0.20)",  fg: "#8892a4" },
  };
  const c = palette[text] ?? { bg: "rgba(85,95,110,0.20)", fg: "#8892a4" };
  return <span style={{ display: "inline-block", padding: "2px 6px", borderRadius: 4, background: c.bg, color: muted ? "#555f6e" : c.fg, fontSize: 10, fontWeight: 600 }}>{text}</span>;
}

function roasColor(r: number) { return r >= 2 ? "#22c55e" : r >= 1 ? "#f59e0b" : r > 0 ? "#ef4444" : "#555f6e"; }
function acosColor(a: number) { return a === 0 ? "#555f6e" : a <= 25 ? "#22c55e" : a <= 50 ? "#f59e0b" : "#ef4444"; }

const inputStyle: React.CSSProperties = {
  background: "#0d1117", border: "1px solid #2a3245", borderRadius: 6,
  color: "#e2e8f0", padding: "6px 10px", fontSize: 12, outline: "none",
};
function chipStyleOn(on: boolean): React.CSSProperties {
  return {
    padding: "6px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
    background: on ? "rgba(99,102,241,0.18)" : "#1c2333",
    color:      on ? "#a5b4fc" : "#8892a4",
    border:    `1px solid ${on ? "#6366f1" : "#2a3245"}`,
  };
}
function tabBtn(active: boolean): React.CSSProperties {
  return {
    padding: "6px 14px", borderRadius: 6, fontSize: 12,
    background: active ? "#1c2333" : "transparent",
    color: active ? "#e2e8f0" : "#8892a4",
    border: active ? "1px solid #2a3245" : "1px solid transparent",
    fontWeight: active ? 600 : 400, cursor: "pointer",
    borderBottom: active ? "2px solid #6366f1" : "2px solid transparent",
  };
}
function pagerBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: "4px 10px", borderRadius: 4, fontSize: 11,
    background: "#1c2333", border: "1px solid #2a3245",
    color: disabled ? "#555f6e" : "#a5b4fc",
    cursor: disabled ? "default" : "pointer",
  };
}

const tableStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 12 };
const tableHeadRow: React.CSSProperties = { borderBottom: "1px solid #2a3245" };
const tableRow: React.CSSProperties = { borderBottom: "1px solid #1c2333" };
const tableRowClickable: React.CSSProperties = { ...tableRow, cursor: "pointer" };
const cellNameStyle: React.CSSProperties = { color: "#e2e8f0", maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const crumbSep: React.CSSProperties = { margin: "0 6px", color: "#555f6e" };
function crumbBtn(active: boolean): React.CSSProperties {
  return {
    background: "transparent", border: "none", padding: 0,
    color: active ? "#e2e8f0" : "#8892a4",
    fontWeight: active ? 600 : 400, cursor: active ? "default" : "pointer",
    fontSize: 11,
  };
}
