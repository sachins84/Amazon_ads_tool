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

interface CampaignRow {
  id: string; name: string; type: Program; status: Status;
  budget: number; portfolioId: string | null;
  targetingType?: "MANUAL" | "AUTO";
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
  id: string; kind: "KEYWORD" | "PRODUCT_TARGET"; display: string;
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
}
interface AdGroupFilters  { search: string; status: Status | "ALL"; }
interface TargetingFilters {
  search: string;
  kind: "ALL" | "KEYWORD" | "PRODUCT_TARGET";
  matchType: "ALL" | "EXACT" | "PHRASE" | "BROAD";
  status: Status | "ALL";
  bidMin: string; bidMax: string;
  acosMin: string; acosMax: string;
  spendMin: string;
}

type Level = "CAMPAIGNS" | "ADGROUPS" | "TARGETS";
type Tab   = "HIERARCHY" | "FLAT";

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
    setTimeout(() => setToast(null), 3500);
  }, []);

  const [campFilters, setCampFilters] = useState<CampaignFilters>({ search: "", programs: ["SP","SB","SD"], targetingType: "ALL", status: "ALL" });
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
      setTargets([...(data.keywords ?? []), ...(data.productTargets ?? [])]);
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
            onQueue={async (c, action) => { await runQueue(accountId, c, action); showToast("Queued in /suggestions"); }} />
        )}
        {accountId && tab === "HIERARCHY" && level === "ADGROUPS" && (
          <AdGroupsView  filters={agFilters}   setFilters={setAgFilters}   rows={filteredAdGroups}   loading={loading} currency={currency} onDrill={drillIntoAdGroup}
            onQueue={async (ag, action) => { await runQueue(accountId, ag, action); showToast("Queued in /suggestions"); }} />
        )}
        {accountId && tab === "HIERARCHY" && level === "TARGETS" && (
          <TargetsView   filters={tgFilters}   setFilters={setTgFilters}   rows={filteredTargets}    loading={loading} currency={currency}
            onQueue={async (t, action) => { await runQueue(accountId, t, action); showToast("Queued in /suggestions"); }} />
        )}
        {accountId && tab === "FLAT" && (
          <FlatView filters={flatFilters} setFilters={(f) => { setFlatPage(0); setFlatFilters(f); }} rows={flatRows} totalCount={flatCount} loading={loading} currency={currency} page={flatPage} setPage={setFlatPage} pageSize={FLAT_PAGE_SIZE}
            onQueue={async (t, action) => { await runQueue(accountId, t, action); showToast("Queued in /suggestions"); }} />
        )}

        {/* Toast */}
        {toast && (
          <div style={{
            position: "fixed", bottom: 20, right: 20, zIndex: 100,
            padding: "10px 16px", borderRadius: 8, fontSize: 12,
            background: toast.kind === "ok" ? "rgba(34,197,94,0.18)" : "rgba(239,68,68,0.18)",
            border: `1px solid ${toast.kind === "ok" ? "#22c55e" : "#ef4444"}`,
            color: toast.kind === "ok" ? "#86efac" : "#ef4444",
          }}>{toast.msg}</div>
        )}
      </main>
    </div>
  );
}

// ─── Queue handler ───────────────────────────────────────────────────────────

type QueueAction =
  | { kind: "PAUSE" }
  | { kind: "ENABLE" }
  | { kind: "SET_BID";    value: number }
  | { kind: "SET_BUDGET"; value: number };

async function runQueue(
  accountId: string,
  row: CampaignRow | AdGroupRow | TargetingRow | FlatTarget,
  action: QueueAction,
): Promise<void> {
  // Figure out targetType + name + bid/budget from the row shape.
  let targetType: "CAMPAIGN" | "AD_GROUP" | "KEYWORD" | "PRODUCT_TARGET";
  let targetName: string;
  let program: "SP" | "SB" | "SD" | undefined;
  let currentValue: number | undefined;

  if ("budget" in row) {                       // CampaignRow
    targetType = "CAMPAIGN";
    targetName = row.name;
    program    = row.type;
    currentValue = row.budget;
  } else if ("defaultBid" in row) {            // AdGroupRow
    targetType = "AD_GROUP";
    targetName = row.name;
    program    = row.type;
    currentValue = row.defaultBid;
  } else if ("kind" in row) {                  // TargetingRow (hierarchy)
    targetType = row.kind;
    targetName = row.display;
    program    = "SP";
    currentValue = row.bid;
  } else {                                     // FlatTarget
    targetType = row.type === "KEYWORD" ? "KEYWORD" : "PRODUCT_TARGET";
    targetName = row.value;
    program    = "SP";
    currentValue = row.bid;
  }

  const actionType =
    action.kind === "PAUSE"  ? "PAUSE"  :
    action.kind === "ENABLE" ? "ENABLE" :
    action.kind === "SET_BID" ? "SET_BID" : "SET_BUDGET";
  const actionValue = "value" in action ? action.value : undefined;

  await queueSuggestion({
    accountId,
    targetType,
    targetId: row.id,
    targetName,
    program,
    actionType,
    actionValue,
    currentValue,
  });
}

// ─── Hierarchy: Campaigns view ───────────────────────────────────────────────

function CampaignsView({ filters, setFilters, rows, loading, currency, onDrill, onQueue }: {
  filters: CampaignFilters; setFilters: (f: CampaignFilters) => void;
  rows: CampaignRow[]; loading: boolean; currency: string;
  onDrill: (c: CampaignRow) => void;
  onQueue: (c: CampaignRow, action: QueueAction) => Promise<void> | void;
}) {
  const toggleProgram = (p: Program) => {
    const next = filters.programs.includes(p) ? filters.programs.filter((x) => x !== p) : [...filters.programs, p];
    setFilters({ ...filters, programs: next });
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
      <TableShell loading={loading}>
        <table style={tableStyle}>
          <thead>
            <tr style={tableHeadRow}>
              <Th>Type</Th><Th>Targeting</Th><Th>Status</Th><Th align="left">Campaign</Th>
              <Th align="right">Budget</Th><Th align="right">Spend</Th><Th align="right">Sales</Th>
              <Th align="right">Orders</Th><Th align="right">ROAS</Th><Th align="right">ACOS</Th><Th align="right">CTR</Th>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} style={tableRow}>
                <Td onClick={() => onDrill(c)} style={{ cursor: "pointer" }}><Pill text={c.type} /></Td>
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
                <Td align="right">
                  <RowActions
                    state={c.status} currency={currency}
                    onToggle={() => onQueue(c, { kind: c.status === "ENABLED" ? "PAUSE" : "ENABLE" })}
                    onEdit={() => {
                      const v = window.prompt(`New daily budget for "${c.name}":`, String(c.budget));
                      if (v == null) return;
                      const n = parseFloat(v); if (isNaN(n) || n <= 0) return;
                      onQueue(c, { kind: "SET_BUDGET", value: n });
                    }}
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

function AdGroupsView({ filters, setFilters, rows, loading, currency, onDrill, onQueue }: {
  filters: AdGroupFilters; setFilters: (f: AdGroupFilters) => void;
  rows: AdGroupRow[]; loading: boolean; currency: string;
  onDrill: (a: AdGroupRow) => void;
  onQueue: (a: AdGroupRow, action: QueueAction) => Promise<void> | void;
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
                <Td align="right">
                  <RowActions
                    state={ag.status} currency={currency}
                    onToggle={() => onQueue(ag, { kind: ag.status === "ENABLED" ? "PAUSE" : "ENABLE" })}
                    onEdit={() => {
                      const v = window.prompt(`New default bid for "${ag.name}":`, String(ag.defaultBid));
                      if (v == null) return;
                      const n = parseFloat(v); if (isNaN(n) || n <= 0) return;
                      onQueue(ag, { kind: "SET_BID", value: n });
                    }}
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

function TargetsView({ filters, setFilters, rows, loading, currency, onQueue }: {
  filters: TargetingFilters; setFilters: (f: TargetingFilters) => void;
  rows: TargetingRow[]; loading: boolean; currency: string;
  onQueue: (t: TargetingRow, action: QueueAction) => Promise<void> | void;
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
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} style={tableRow}>
                <Td><Pill text={t.kind === "KEYWORD" ? "KW" : "PT"} /></Td>
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
                <Td align="right">
                  <RowActions
                    state={t.state} currency={currency}
                    onToggle={() => onQueue(t, { kind: t.state === "ENABLED" ? "PAUSE" : "ENABLE" })}
                    onEdit={() => {
                      const v = window.prompt(`New bid for "${t.display}":`, String(t.bid));
                      if (v == null) return;
                      const n = parseFloat(v); if (isNaN(n) || n <= 0) return;
                      onQueue(t, { kind: "SET_BID", value: n });
                    }}
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

function FlatView({ filters, setFilters, rows, totalCount, loading, currency, page, setPage, pageSize, onQueue }: {
  filters: TargetingFilters; setFilters: (f: TargetingFilters) => void;
  rows: FlatTarget[]; totalCount: number;
  loading: boolean; currency: string;
  page: number; setPage: (p: number) => void;
  pageSize: number;
  onQueue: (t: FlatTarget, action: QueueAction) => Promise<void> | void;
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
                <Td align="right">
                  <RowActions
                    state={t.status} currency={currency}
                    onToggle={() => onQueue(t, { kind: t.status === "ENABLED" ? "PAUSE" : "ENABLE" })}
                    onEdit={() => {
                      const v = window.prompt(`New bid for "${t.value}":`, String(t.bid));
                      if (v == null) return;
                      const n = parseFloat(v); if (isNaN(n) || n <= 0) return;
                      onQueue(t, { kind: "SET_BID", value: n });
                    }}
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
function RowActions({ state, onToggle, onEdit, editLabel }: {
  state: Status;
  currency: string;
  onToggle: () => void;
  onEdit: () => void;
  editLabel: string;
}) {
  const pauseEnable = state === "ENABLED" ? "Pause" : "Enable";
  return (
    <div style={{ display: "inline-flex", gap: 6, justifyContent: "flex-end" }} onClick={(e) => e.stopPropagation()}>
      <button onClick={onToggle} style={miniBtn} title={`Queue ${pauseEnable.toLowerCase()} suggestion`}>
        {pauseEnable}
      </button>
      <button onClick={onEdit} style={miniBtn} title={editLabel}>
        ✎ {editLabel.split(" ")[1]}
      </button>
    </div>
  );
}

const miniBtn: React.CSSProperties = {
  padding: "3px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600,
  background: "#1c2333", border: "1px solid #2a3245",
  color: "#a5b4fc", cursor: "pointer",
};

function Pill({ text, muted }: { text: string; muted?: boolean }) {
  const palette: Record<string, { bg: string; fg: string }> = {
    SP:       { bg: "rgba(99,102,241,0.15)", fg: "#a5b4fc" },
    SB:       { bg: "rgba(139,92,246,0.15)", fg: "#c4b5fd" },
    SD:       { bg: "rgba(167,139,250,0.15)", fg: "#ddd6fe" },
    KW:       { bg: "rgba(99,102,241,0.15)", fg: "#a5b4fc" },
    PT:       { bg: "rgba(167,139,250,0.15)", fg: "#ddd6fe" },
    MANUAL:   { bg: "rgba(34,197,94,0.12)",  fg: "#86efac" },
    AUTO:     { bg: "rgba(245,158,11,0.12)", fg: "#fde68a" },
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
