"use client";
/**
 * 4-step modal wizard for creating an SP campaign.
 *
 * Step 1: Campaign config (name, budget, start, state, targeting type, dynamic bidding)
 * Step 2: Ad Group (name, default bid)
 * Step 3: ASINs (one per line)
 * Step 4: Targeting
 *   - MANUAL → keyword list (text, match, bid) + optional product targets
 *   - AUTO   → bid for each of the 4 expression types
 *
 * Final confirm: "Are you sure? This pushes live to Amazon."
 */
import { useState, useEffect } from "react";
import { fmt } from "@/lib/utils";

type Step = 1 | 2 | 3 | 4 | 5; // 5 = final review/confirm

type MatchType = "EXACT" | "PHRASE" | "BROAD";
type Targeting = "MANUAL" | "AUTO";
type AutoExpr = "queryHighRelMatches" | "queryBroadRelMatches" | "asinSubstituteRelated" | "asinAccessoryRelated";

interface WizardState {
  campaign: {
    name: string;
    dailyBudget: number;
    startDate: string;
    endDate?: string;
    state: "ENABLED" | "PAUSED";
    targetingType: Targeting;
    portfolioId?: string;
    strategy: "LEGACY_FOR_SALES" | "AUTO_FOR_SALES" | "MANUAL" | "RULE_BASED";
    topOfSearchPct: number;
    productPagePct: number;
  };
  adGroup:    { name: string; defaultBid: number };
  asins:      string[];
  keywords:   { text: string; matchType: MatchType; bid: number }[];
  asinTargets:{ asin: string; bid: number }[];
  auto:       { close: number; loose: number; substitutes: number; complements: number };
}

const today = () => new Date().toISOString().slice(0, 10);

const initial = (): WizardState => ({
  campaign: {
    name: "", dailyBudget: 100, startDate: today(),
    state: "ENABLED", targetingType: "MANUAL",
    strategy: "LEGACY_FOR_SALES",
    topOfSearchPct: 0, productPagePct: 0,
  },
  adGroup: { name: "Ad group 1", defaultBid: 1.00 },
  asins: [],
  keywords: [],
  asinTargets: [],
  auto: { close: 1.00, loose: 0.80, substitutes: 0.80, complements: 0.80 },
});

export default function CreateCampaignWizard({ accountId, currency, onClose, onCreated }: {
  accountId: string;
  currency: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [step, setStep] = useState<Step>(1);
  const [s, setS] = useState<WizardState>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<null | {
    success: boolean;
    steps: Record<string, { ok: boolean; campaignId?: string; adGroupId?: string; count?: number; message?: string }>;
  }>(null);

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const next = () => setStep((x) => Math.min(5, (x + 1)) as Step);
  const back = () => setStep((x) => Math.max(1, (x - 1)) as Step);

  const submit = async () => {
    const ok = confirm(`Are you sure you want to create this campaign on Amazon?\n\n"${s.campaign.name}" with daily budget ${fmt(s.campaign.dailyBudget, "currency", currency)}.\n\nThis pushes live immediately.`);
    if (!ok) return;
    setSubmitting(true);
    try {
      const body = buildBody(accountId, s);
      const res = await fetch("/api/sp-campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      setResult(json);
      if (json.success) onCreated();
    } catch (e) {
      setResult({ success: false, steps: { error: { ok: false, message: String(e) } } });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={backdrop} onClick={onClose}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#e2e8f0" }}>Create Sponsored Products Campaign</div>
          <button onClick={onClose} style={closeBtn}>✕</button>
        </div>

        <StepNav step={step} targetingType={s.campaign.targetingType} />

        <div style={{ marginTop: 12, minHeight: 320 }}>
          {result ? (
            <ResultView result={result} onClose={onClose} />
          ) : (
            <>
              {step === 1 && <Step1 s={s} setS={setS} currency={currency} />}
              {step === 2 && <Step2 s={s} setS={setS} currency={currency} />}
              {step === 3 && <Step3 s={s} setS={setS} />}
              {step === 4 && <Step4 s={s} setS={setS} currency={currency} />}
              {step === 5 && <Step5 s={s} currency={currency} />}
            </>
          )}
        </div>

        {!result && (
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16, gap: 8 }}>
            <button onClick={onClose} style={btnCancel} disabled={submitting}>Cancel</button>
            <div style={{ display: "flex", gap: 8 }}>
              {step > 1 && <button onClick={back} style={btnSecondary} disabled={submitting}>← Back</button>}
              {step < 5 && <button onClick={next} disabled={!stepValid(step, s)} style={btnPrimary(!stepValid(step, s))}>Next →</button>}
              {step === 5 && <button onClick={submit} disabled={submitting} style={btnPrimary(submitting)}>
                {submitting ? "Creating…" : "Create on Amazon"}
              </button>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Steps ───────────────────────────────────────────────────────────────────

function StepNav({ step, targetingType }: { step: Step; targetingType: Targeting }) {
  const labels = ["Campaign", "Ad Group", "Product Ads", targetingType === "AUTO" ? "Auto bids" : "Keywords / Targets", "Review"];
  return (
    <div style={{ display: "flex", gap: 6, fontSize: 11 }}>
      {labels.map((l, i) => {
        const stepNum = i + 1;
        const active = stepNum === step;
        const done = stepNum < step;
        return (
          <div key={l} style={{
            flex: 1, padding: "6px 10px", borderRadius: 4, textAlign: "center",
            background: active ? "rgba(99,102,241,0.15)" : done ? "rgba(34,197,94,0.10)" : "#1c2333",
            color:      active ? "#a5b4fc" : done ? "#86efac" : "#8892a4",
            borderBottom: active ? "2px solid #6366f1" : "2px solid transparent",
            fontWeight: active ? 600 : 400,
          }}>{stepNum}. {l}</div>
        );
      })}
    </div>
  );
}

function Step1({ s, setS, currency }: { s: WizardState; setS: (n: WizardState) => void; currency: string }) {
  const c = s.campaign;
  const update = (patch: Partial<WizardState["campaign"]>) => setS({ ...s, campaign: { ...c, ...patch } });
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <Field label="Campaign name *">
        <input value={c.name} onChange={(e) => update({ name: e.target.value })} placeholder="e.g. SP_BB_HGR_Generic_Exact" style={input} autoFocus />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <Field label={`Daily budget (${currency}) *`}>
          <input type="number" min="1" step="1" value={c.dailyBudget} onChange={(e) => update({ dailyBudget: parseFloat(e.target.value) || 0 })} style={input} />
        </Field>
        <Field label="Start date *">
          <input type="date" value={c.startDate} onChange={(e) => update({ startDate: e.target.value })} style={input} />
        </Field>
        <Field label="End date (optional)">
          <input type="date" value={c.endDate ?? ""} onChange={(e) => update({ endDate: e.target.value || undefined })} style={input} />
        </Field>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <Field label="Initial state">
          <select value={c.state} onChange={(e) => update({ state: e.target.value as "ENABLED" | "PAUSED" })} style={input}>
            <option value="ENABLED">Enabled (start serving)</option>
            <option value="PAUSED">Paused (ready, not serving)</option>
          </select>
        </Field>
        <Field label="Targeting type">
          <select value={c.targetingType} onChange={(e) => update({ targetingType: e.target.value as Targeting })} style={input}>
            <option value="MANUAL">Manual (keywords / product targets)</option>
            <option value="AUTO">Auto (Amazon picks)</option>
          </select>
        </Field>
        <Field label="Bidding strategy">
          <select value={c.strategy} onChange={(e) => update({ strategy: e.target.value as WizardState["campaign"]["strategy"] })} style={input}>
            <option value="LEGACY_FOR_SALES">Dynamic – down only</option>
            <option value="AUTO_FOR_SALES">Dynamic – up & down</option>
            <option value="MANUAL">Fixed</option>
            <option value="RULE_BASED">Rule-based</option>
          </select>
        </Field>
      </div>
      <Field label="Placement adjustments (%)">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <div style={miniLabel}>Top of search</div>
            <input type="number" min="0" max="900" value={c.topOfSearchPct} onChange={(e) => update({ topOfSearchPct: parseInt(e.target.value) || 0 })} style={input} />
          </div>
          <div>
            <div style={miniLabel}>Product pages</div>
            <input type="number" min="0" max="900" value={c.productPagePct} onChange={(e) => update({ productPagePct: parseInt(e.target.value) || 0 })} style={input} />
          </div>
        </div>
      </Field>
    </div>
  );
}

function Step2({ s, setS, currency }: { s: WizardState; setS: (n: WizardState) => void; currency: string }) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <Field label="Ad group name *">
        <input value={s.adGroup.name} onChange={(e) => setS({ ...s, adGroup: { ...s.adGroup, name: e.target.value } })} style={input} autoFocus />
      </Field>
      <Field label={`Default bid (${currency}) *`}>
        <input type="number" min="0.02" step="0.01" value={s.adGroup.defaultBid} onChange={(e) => setS({ ...s, adGroup: { ...s.adGroup, defaultBid: parseFloat(e.target.value) || 0 } })} style={input} />
      </Field>
      <div style={hintBox}>Used for any keyword/target that doesn't have its own bid set.</div>
    </div>
  );
}

function Step3({ s, setS }: { s: WizardState; setS: (n: WizardState) => void }) {
  const [text, setText] = useState(s.asins.join("\n"));
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <Field label="ASINs to advertise (one per line) *">
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const list = e.target.value.split(/\s+/).map((x) => x.trim().toUpperCase()).filter((x) => /^B0[A-Z0-9]{8}$/.test(x));
            setS({ ...s, asins: list });
          }}
          placeholder={"B0FDQYJ7FH\nB0FDR14FSM"}
          rows={10} style={{ ...input, fontFamily: "ui-monospace, monospace", resize: "vertical" }}
        />
      </Field>
      <div style={hintBox}>Detected {s.asins.length} valid ASIN{s.asins.length === 1 ? "" : "s"}. ASINs must be 10 chars starting with <code>B0</code>.</div>
    </div>
  );
}

function Step4({ s, setS, currency }: { s: WizardState; setS: (n: WizardState) => void; currency: string }) {
  if (s.campaign.targetingType === "AUTO") {
    return (
      <div style={{ display: "grid", gap: 12 }}>
        <div style={hintBox}>Amazon serves your ads to four auto-targeting groups. Set a bid for each (0 to disable).</div>
        <AutoBid label="Close match"  hint="Same exact intent as your ASIN" value={s.auto.close} onChange={(v) => setS({ ...s, auto: { ...s.auto, close: v } })} currency={currency} />
        <AutoBid label="Loose match"  hint="Related search terms" value={s.auto.loose} onChange={(v) => setS({ ...s, auto: { ...s.auto, loose: v } })} currency={currency} />
        <AutoBid label="Substitutes"  hint="Customers viewing detail pages of similar products" value={s.auto.substitutes} onChange={(v) => setS({ ...s, auto: { ...s.auto, substitutes: v } })} currency={currency} />
        <AutoBid label="Complements"  hint="Customers viewing detail pages of complementary products" value={s.auto.complements} onChange={(v) => setS({ ...s, auto: { ...s.auto, complements: v } })} currency={currency} />
      </div>
    );
  }
  // MANUAL
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <KeywordsList s={s} setS={setS} currency={currency} />
      <AsinTargetsList s={s} setS={setS} currency={currency} />
    </div>
  );
}

function KeywordsList({ s, setS, currency }: { s: WizardState; setS: (n: WizardState) => void; currency: string }) {
  const [bulk, setBulk] = useState("");
  const addBulk = () => {
    const adds = bulk.split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((text) => ({ text, matchType: "EXACT" as MatchType, bid: s.adGroup.defaultBid }));
    setS({ ...s, keywords: [...s.keywords, ...adds] });
    setBulk("");
  };
  const updateKw = (i: number, patch: Partial<WizardState["keywords"][0]>) =>
    setS({ ...s, keywords: s.keywords.map((k, idx) => idx === i ? { ...k, ...patch } : k) });
  const removeKw = (i: number) =>
    setS({ ...s, keywords: s.keywords.filter((_, idx) => idx !== i) });
  return (
    <div style={{ background: "#0d1117", border: "1px solid #2a3245", borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", marginBottom: 8 }}>Keywords ({s.keywords.length})</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <textarea value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder="Paste keywords, one per line" rows={3} style={{ ...input, flex: 1, fontFamily: "ui-monospace, monospace" }} />
        <button onClick={addBulk} disabled={!bulk.trim()} style={btnPrimary(!bulk.trim())}>Add</button>
      </div>
      {s.keywords.length > 0 && (
        <div style={{ maxHeight: 180, overflowY: "auto" }}>
          {s.keywords.map((k, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 32px", gap: 6, marginBottom: 4 }}>
              <input value={k.text} onChange={(e) => updateKw(i, { text: e.target.value })} style={input} />
              <select value={k.matchType} onChange={(e) => updateKw(i, { matchType: e.target.value as MatchType })} style={input}>
                <option value="EXACT">EXACT</option><option value="PHRASE">PHRASE</option><option value="BROAD">BROAD</option>
              </select>
              <input type="number" step="0.01" min="0.02" value={k.bid} onChange={(e) => updateKw(i, { bid: parseFloat(e.target.value) || 0 })} style={input} />
              <button onClick={() => removeKw(i)} style={{ ...btnCancel, padding: "0 8px" }}>×</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ fontSize: 10, color: "#555f6e", marginTop: 4 }}>Default match: EXACT · default bid: {fmt(s.adGroup.defaultBid, "currency", currency)}</div>
    </div>
  );
}

function AsinTargetsList({ s, setS, currency }: { s: WizardState; setS: (n: WizardState) => void; currency: string }) {
  const [bulk, setBulk] = useState("");
  const addBulk = () => {
    const adds = bulk.split(/\s+/)
      .map((l) => l.trim().toUpperCase())
      .filter((l) => /^B0[A-Z0-9]{8}$/.test(l))
      .map((asin) => ({ asin, bid: s.adGroup.defaultBid }));
    setS({ ...s, asinTargets: [...s.asinTargets, ...adds] });
    setBulk("");
  };
  return (
    <div style={{ background: "#0d1117", border: "1px solid #2a3245", borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", marginBottom: 8 }}>Product targets — ASINs ({s.asinTargets.length})</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <textarea value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder="Paste ASINs to target (one per line)" rows={3} style={{ ...input, flex: 1, fontFamily: "ui-monospace, monospace" }} />
        <button onClick={addBulk} disabled={!bulk.trim()} style={btnPrimary(!bulk.trim())}>Add</button>
      </div>
      {s.asinTargets.length > 0 && (
        <div style={{ maxHeight: 140, overflowY: "auto" }}>
          {s.asinTargets.map((t, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 32px", gap: 6, marginBottom: 4 }}>
              <div style={{ ...input, paddingTop: 6, fontFamily: "ui-monospace, monospace" }}>{t.asin}</div>
              <input type="number" step="0.01" min="0.02" value={t.bid} onChange={(e) => setS({ ...s, asinTargets: s.asinTargets.map((x, idx) => idx === i ? { ...x, bid: parseFloat(e.target.value) || 0 } : x) })} style={input} />
              <button onClick={() => setS({ ...s, asinTargets: s.asinTargets.filter((_, idx) => idx !== i) })} style={{ ...btnCancel, padding: "0 8px" }}>×</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ fontSize: 10, color: "#555f6e", marginTop: 4 }}>Default bid: {fmt(s.adGroup.defaultBid, "currency", currency)}</div>
    </div>
  );
}

function AutoBid({ label, hint, value, onChange, currency }: { label: string; hint: string; value: number; onChange: (v: number) => void; currency: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 140px", gap: 12, alignItems: "center" }}>
      <div>
        <div style={{ fontSize: 12, color: "#e2e8f0", fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 11, color: "#8892a4" }}>{hint}</div>
      </div>
      <input type="number" step="0.01" min="0" value={value} onChange={(e) => onChange(parseFloat(e.target.value) || 0)} style={input} title={currency} />
    </div>
  );
}

function Step5({ s, currency }: { s: WizardState; currency: string }) {
  return (
    <div style={{ display: "grid", gap: 8, fontSize: 12, color: "#e2e8f0" }}>
      <div style={{ background: "rgba(99,102,241,0.10)", border: "1px solid #6366f1", borderRadius: 8, padding: 12, color: "#a5b4fc" }}>
        Review the configuration below. Clicking <strong>Create on Amazon</strong> below will ask for one final confirmation before pushing the changes live.
      </div>
      <ReviewBlock title="Campaign" rows={[
        ["Name", s.campaign.name],
        ["Daily budget", fmt(s.campaign.dailyBudget, "currency", currency)],
        ["Start", s.campaign.startDate],
        ["End", s.campaign.endDate ?? "—"],
        ["Initial state", s.campaign.state],
        ["Targeting", s.campaign.targetingType],
        ["Strategy", s.campaign.strategy],
        ["TOS / PP adjustments", `${s.campaign.topOfSearchPct}% / ${s.campaign.productPagePct}%`],
      ]} />
      <ReviewBlock title="Ad Group" rows={[
        ["Name", s.adGroup.name],
        ["Default bid", fmt(s.adGroup.defaultBid, "currency", currency)],
      ]} />
      <ReviewBlock title={`Product Ads (${s.asins.length} ASIN${s.asins.length === 1 ? "" : "s"})`} rows={[["ASINs", s.asins.length ? s.asins.join(", ") : "—"]]} />
      {s.campaign.targetingType === "MANUAL" ? (
        <ReviewBlock title="Targeting" rows={[
          ["Keywords",       `${s.keywords.length}`],
          ["Product targets", `${s.asinTargets.length}`],
        ]} />
      ) : (
        <ReviewBlock title="Auto bids" rows={[
          ["Close match",   fmt(s.auto.close,        "currency", currency)],
          ["Loose match",   fmt(s.auto.loose,        "currency", currency)],
          ["Substitutes",   fmt(s.auto.substitutes,  "currency", currency)],
          ["Complements",   fmt(s.auto.complements,  "currency", currency)],
        ]} />
      )}
    </div>
  );
}

function ReviewBlock({ title, rows }: { title: string; rows: [string, string | number][] }) {
  return (
    <div style={{ background: "#0d1117", border: "1px solid #2a3245", borderRadius: 8, padding: "10px 12px" }}>
      <div style={{ fontSize: 11, color: "#8892a4", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>{title}</div>
      <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "4px 16px", fontSize: 12 }}>
        {rows.map(([k, v]) => <Fragment key={k}><span style={{ color: "#8892a4" }}>{k}</span><span style={{ color: "#e2e8f0" }}>{v}</span></Fragment>)}
      </div>
    </div>
  );
}
// Why the noop Fragment alias: keeps the .map shape readable without React.Fragment imports.
import { Fragment } from "react";

function ResultView({ result, onClose }: { result: { success: boolean; steps: Record<string, { ok: boolean; campaignId?: string; adGroupId?: string; count?: number; message?: string }> }; onClose: () => void }) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{
        padding: 12, borderRadius: 8, fontSize: 13,
        background: result.success ? "rgba(34,197,94,0.12)" : "rgba(245,158,11,0.12)",
        color:      result.success ? "#86efac" : "#fde68a",
        border: `1px solid ${result.success ? "#22c55e" : "#f59e0b"}`,
      }}>
        {result.success ? "✓ Campaign created successfully" : "⚠ Some steps failed — see below. Already-created entities exist on Amazon."}
      </div>
      {Object.entries(result.steps).map(([k, v]) => (
        <div key={k} style={{ background: "#0d1117", border: "1px solid #2a3245", borderRadius: 6, padding: 10, fontSize: 12 }}>
          <div style={{ color: v?.ok ? "#86efac" : "#ef4444" }}>{v?.ok ? "✓" : "✕"} {k}</div>
          {v?.campaignId && <div style={{ color: "#8892a4", marginTop: 2 }}>campaignId: <code>{v.campaignId}</code></div>}
          {v?.adGroupId  && <div style={{ color: "#8892a4", marginTop: 2 }}>adGroupId: <code>{v.adGroupId}</code></div>}
          {v?.count !== undefined && <div style={{ color: "#8892a4", marginTop: 2 }}>{v.count} item(s)</div>}
          {v?.message    && <div style={{ color: "#ef4444", marginTop: 2 }}>{v.message}</div>}
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button onClick={onClose} style={btnPrimary(false)}>Close</button>
      </div>
    </div>
  );
}

// ─── Validation ─────────────────────────────────────────────────────────────

function stepValid(step: Step, s: WizardState): boolean {
  if (step === 1) return s.campaign.name.trim().length > 0 && s.campaign.dailyBudget > 0 && !!s.campaign.startDate;
  if (step === 2) return s.adGroup.name.trim().length > 0 && s.adGroup.defaultBid > 0;
  if (step === 3) return s.asins.length > 0;
  if (step === 4) {
    if (s.campaign.targetingType === "AUTO") return true;
    return s.keywords.length > 0 || s.asinTargets.length > 0;
  }
  return true;
}

// ─── Build request body ─────────────────────────────────────────────────────

function buildBody(accountId: string, s: WizardState) {
  const placementBidding: { placement: "PLACEMENT_TOP" | "PLACEMENT_PRODUCT_PAGE"; percentage: number }[] = [];
  if (s.campaign.topOfSearchPct > 0) placementBidding.push({ placement: "PLACEMENT_TOP", percentage: s.campaign.topOfSearchPct });
  if (s.campaign.productPagePct > 0) placementBidding.push({ placement: "PLACEMENT_PRODUCT_PAGE", percentage: s.campaign.productPagePct });

  const body: Record<string, unknown> = {
    accountId,
    campaign: {
      name: s.campaign.name,
      dailyBudget: s.campaign.dailyBudget,
      startDate: s.campaign.startDate,
      endDate: s.campaign.endDate,
      state: s.campaign.state,
      targetingType: s.campaign.targetingType,
      portfolioId: s.campaign.portfolioId,
      dynamicBidding: {
        strategy: s.campaign.strategy,
        placementBidding: placementBidding.length ? placementBidding : undefined,
      },
    },
    adGroup: s.adGroup,
    productAds: s.asins.map((asin) => ({ asin })),
  };
  if (s.campaign.targetingType === "MANUAL") {
    body.keywords = s.keywords;
    body.productTargets = s.asinTargets.map((t) => ({
      expression: [{ type: "asinSameAs", value: t.asin }],
      bid: t.bid,
    }));
  } else {
    body.auto = [
      { type: "queryHighRelMatches",   bid: s.auto.close },
      { type: "queryBroadRelMatches",  bid: s.auto.loose },
      { type: "asinSubstituteRelated", bid: s.auto.substitutes },
      { type: "asinAccessoryRelated",  bid: s.auto.complements },
    ].filter((x) => x.bid > 0);
  }
  return body;
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const backdrop: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 300,
  display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "5vh",
  overflowY: "auto",
};
const card: React.CSSProperties = {
  background: "#161b27", border: "1px solid #2a3245", borderRadius: 10,
  padding: 20, width: 720, maxWidth: "95vw", marginBottom: 40,
};
const closeBtn: React.CSSProperties = {
  background: "transparent", border: "none", color: "#8892a4",
  fontSize: 18, cursor: "pointer",
};
const input: React.CSSProperties = {
  background: "#0d1117", border: "1px solid #2a3245", borderRadius: 6,
  color: "#e2e8f0", padding: "6px 10px", fontSize: 12, outline: "none", width: "100%",
};
const miniLabel: React.CSSProperties = { fontSize: 10, color: "#8892a4", marginBottom: 4 };
const hintBox: React.CSSProperties = {
  fontSize: 11, color: "#a5b4fc",
  padding: "8px 10px", background: "rgba(99,102,241,0.08)",
  border: "1px solid rgba(99,102,241,0.18)", borderRadius: 6,
};
const btnCancel: React.CSSProperties = {
  padding: "6px 12px", borderRadius: 6, background: "transparent",
  border: "1px solid #2a3245", color: "#8892a4", fontSize: 12, cursor: "pointer",
};
const btnSecondary: React.CSSProperties = {
  padding: "6px 12px", borderRadius: 6, background: "#1c2333",
  border: "1px solid #2a3245", color: "#a5b4fc", fontSize: 12, cursor: "pointer",
};
function btnPrimary(disabled: boolean): React.CSSProperties {
  return {
    padding: "6px 14px", borderRadius: 6,
    background: disabled ? "#1c2333" : "linear-gradient(135deg,#6366f1,#8b5cf6)",
    border: "1px solid transparent",
    color: disabled ? "#555f6e" : "#fff",
    fontSize: 12, fontWeight: 600,
    cursor: disabled ? "default" : "pointer",
  };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "#8892a4", marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}
