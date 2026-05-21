"use client";
/**
 * /pnl — brand-wise P&L waterfall.
 *
 * Cards in order: gross sales → RTO → post-RTO → GST → reviews → commission
 * → net revenue → logistics → ad spend → COGS → CM2. Each "minus" row shows
 * the factor (sourced from /accounts) and the deducted amount. Totals
 * (Gross / Post-RTO / Net Revenue / CM2) are highlighted as anchors.
 */
import { useCallback, useEffect, useState } from "react";
import TopNav from "@/components/shared/TopNav";
import DataWindowBanner from "@/components/shared/DataWindowBanner";
import { useAccount } from "@/lib/account-context";
import { fmt } from "@/lib/utils";

interface Factor { factor: number; amount: number }
interface FeeFactor extends Factor { source: "actual" | "estimate"; estimate: number; reason?: string }
interface PnlResp {
  accountId: string;
  accountName: string;
  brandKey: string;
  dateRange: string;
  range: { startDate: string; endDate: string };
  waterfall: {
    grossSales: number;
    rto:        Factor;
    postRtoSales: number;
    gst:        Factor;
    reviews:    Factor;
    commission: FeeFactor;
    netRevenue: number;
    logistics:  FeeFactor;
    adSpend:    number;
    cogs:       Factor;
    cm2:        number;
    cm2Pct:     number;
  };
  feeDiagnostics: {
    source: "actual" | "estimate";
    reason: string;
    skusSeen: number;
    skusMatched: number;
    skusForBrand: number;
    refunds: number;
    error?: string;
  } | null;
  salesError: string | null;
  error?: string;
  code?: string;
}

const PRESETS = ["Yesterday", "Last 7D", "Last 14D", "Last 30D", "Last 60D"];

export default function PnlPage() {
  const { activeAccount } = useAccount();
  const accountId = activeAccount?.id ?? "";
  const currency  = activeAccount?.adsMarketplace === "IN" ? "INR" : "USD";

  const [preset, setPreset] = useState("Last 7D");
  const [data, setData] = useState<PnlResp | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) { setData(null); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/pnl?accountId=${accountId}&dateRange=${encodeURIComponent(preset)}`, { cache: "no-store" });
      setData(await res.json());
    } finally { setLoading(false); }
  }, [accountId, preset]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-base)" }}>
      <TopNav />
      <main style={{ padding: "24px 28px", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>Brand P&L</h1>
            <p style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
              {accountId ? `${activeAccount?.name} · ${currency}` : "Pick a brand"} · waterfall from gross sales to CM2
            </p>
          </div>
          <select value={preset} onChange={(e) => setPreset(e.target.value)} style={input}>
            {PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        <div style={{ marginBottom: 12 }}>
          <DataWindowBanner accountId={accountId} window={`P&L window: ${preset}`} />
        </div>

        {!accountId ? (
          <div style={empty}>Pick a brand from the top-right dropdown.</div>
        ) : (
          <div style={{ position: "relative", opacity: loading ? 0.5 : 1, transition: "opacity 0.15s" }}>
            {loading && (
              <div style={{
                position: "absolute", top: 8, right: 8, zIndex: 1,
                background: "var(--bg-card)", border: "1px solid var(--border)",
                borderRadius: 6, padding: "4px 10px", fontSize: 11,
                color: "var(--text-secondary)",
              }}>
                Loading {preset}…
              </div>
            )}
            {loading && !data ? (
              <div style={empty}>Loading…</div>
            ) : data?.code === "BRAND_KEY_UNKNOWN" ? (
              <div style={{ ...empty, color: "var(--c-warning-text)" }}>{data.error}</div>
            ) : data?.code === "CONFIG_MISSING" ? (
              <div style={{ ...empty, color: "var(--c-warning-text)" }}>{data.error}</div>
            ) : data?.error ? (
              <div style={{ ...empty, color: "var(--c-danger-text)" }}>{data.error}</div>
            ) : data ? (
              <WaterfallView w={data.waterfall} currency={currency} />
            ) : null}
          </div>
        )}

        {data?.feeDiagnostics && (
          <div style={{ ...card, padding: 12, marginTop: 12, fontSize: 11 }}>
            <div style={{ fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>
              Settlements (Finances API) · {data.feeDiagnostics.source === "actual" ? "wired" : "fell back to estimate"}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, color: "var(--text-secondary)" }}>
              <Stat label="SKUs in events" value={String(data.feeDiagnostics.skusSeen)} />
              <Stat label="SKUs matched to brand" value={String(data.feeDiagnostics.skusMatched)} />
              <Stat label="SKUs for this brand" value={String(data.feeDiagnostics.skusForBrand)} />
              <Stat label="Refunds (all brands)" value={fmt(data.feeDiagnostics.refunds, "currency", currency)} />
            </div>
            {data.feeDiagnostics.source === "estimate" && (
              <div style={{ marginTop: 8, color: "var(--c-warning-text)", fontSize: 11 }}>
                Why estimate? {data.feeDiagnostics.reason}
              </div>
            )}
            {data.feeDiagnostics.error && (
              <div style={{ marginTop: 4, color: "var(--c-danger-text)", fontSize: 10, fontFamily: "var(--font-mono, monospace)" }}>
                {data.feeDiagnostics.error}
              </div>
            )}
          </div>
        )}

        {data?.salesError && (
          <div style={{ ...card, padding: 12, marginTop: 12, fontSize: 11, color: "var(--c-danger-text)" }}>
            SP-API sales error: {data.salesError}
          </div>
        )}
      </main>
    </div>
  );
}

// ─── Waterfall ──────────────────────────────────────────────────────────────

function WaterfallView({ w, currency }: { w: PnlResp["waterfall"]; currency: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <SumCard label="Gross Sales" value={w.grossSales} currency={currency} accent="primary" />
      <DeductCard label="RTO"        factor={w.rto}        currency={currency} sublabel="post-delivery returns" />
      <SumCard    label="Post-RTO Sales" value={w.postRtoSales} currency={currency} accent="muted" />
      <DeductCard label="GST"        factor={w.gst}        currency={currency} sublabel="goods & services tax" />
      <DeductCard label="Reviews"    factor={w.reviews}    currency={currency} sublabel="reviewer / influencer cost" />
      <FeeDeductCard label="Commission" factor={w.commission} currency={currency} sublabel="Amazon platform fee" />
      <SumCard    label="Net Revenue" value={w.netRevenue} currency={currency} accent="primary" />
      <FeeDeductCard label="Logistics"  factor={w.logistics}  currency={currency} sublabel="fulfillment + storage" />
      <ManualDeductCard label="Ad Spend" amount={w.adSpend} currency={currency} sublabel="actual spend from campaign metrics" />
      <DeductCard label="COGS"       factor={w.cogs}       currency={currency} sublabel="cost of goods sold" />
      <SumCard    label="Contribution Margin 2 (CM2)" value={w.cm2} currency={currency} accent={w.cm2 >= 0 ? "success" : "danger"} sub={`${w.cm2Pct.toFixed(1)}% of gross sales`} />
    </div>
  );
}

function SumCard({ label, value, currency, accent, sub }: {
  label: string; value: number; currency: string;
  accent: "primary" | "muted" | "success" | "danger";
  sub?: string;
}) {
  const colors: Record<typeof accent, { bg: string; fg: string }> = {
    primary: { bg: "linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.15))", fg: "var(--text-primary)" },
    muted:   { bg: "var(--bg-card)",   fg: "var(--text-primary)"  },
    success: { bg: "var(--c-success-bg)", fg: "var(--c-success-text)" },
    danger:  { bg: "var(--c-danger-bg)",  fg: "var(--c-danger-text)" },
  };
  const c = colors[accent];
  return (
    <div style={{ ...card, background: c.bg, padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: c.fg, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>{sub}</div>}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: c.fg }}>{fmt(value, "currency", currency)}</div>
    </div>
  );
}

function DeductCard({ label, factor, currency, sublabel }: {
  label: string; factor: Factor; currency: string; sublabel?: string;
}) {
  const pct = (factor.factor * 100).toFixed(1);
  return (
    <div style={{ ...card, padding: "10px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", marginLeft: 24 }}>
      <div>
        <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>− {label} <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>· {pct}%</span></div>
        {sublabel && <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{sublabel}</div>}
      </div>
      <div style={{ fontSize: 13, color: "var(--c-warning-text)", fontVariantNumeric: "tabular-nums" }}>
        − {fmt(factor.amount, "currency", currency)}
      </div>
    </div>
  );
}

function FeeDeductCard({ label, factor, currency, sublabel }: {
  label: string; factor: FeeFactor; currency: string; sublabel?: string;
}) {
  const isActual = factor.source === "actual";
  const badgeColors = isActual
    ? { bg: "var(--c-success-bg)", fg: "var(--c-success-text)" }
    : { bg: "var(--bg-input)",     fg: "var(--text-muted)" };
  const pct = (factor.factor * 100).toFixed(1);
  return (
    <div style={{ ...card, padding: "10px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", marginLeft: 24 }}>
      <div>
        <div style={{ fontSize: 12, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 8 }}>
          − {label}
          <span style={{
            background: badgeColors.bg, color: badgeColors.fg,
            fontSize: 9, fontWeight: 700, letterSpacing: "0.05em",
            padding: "2px 6px", borderRadius: 4, textTransform: "uppercase",
          }}>
            {isActual ? "actual" : "estimate"}
          </span>
          {!isActual && <span style={{ color: "var(--text-muted)", fontWeight: 500, fontSize: 11 }}>· {pct}%</span>}
        </div>
        {(sublabel || factor.reason) && (
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2, maxWidth: 480 }}>
            {sublabel}
            {isActual && ` · settlements (vs ${fmt(factor.estimate, "currency", currency)} estimate)`}
            {!isActual && factor.reason && factor.reason !== "ok" && (
              <> · <span style={{ color: "var(--c-warning-text)" }}>{factor.reason}</span></>
            )}
          </div>
        )}
      </div>
      <div style={{ fontSize: 13, color: "var(--c-warning-text)", fontVariantNumeric: "tabular-nums" }}>
        − {fmt(factor.amount, "currency", currency)}
      </div>
    </div>
  );
}

function ManualDeductCard({ label, amount, currency, sublabel }: {
  label: string; amount: number; currency: string; sublabel?: string;
}) {
  return (
    <div style={{ ...card, padding: "10px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", marginLeft: 24 }}>
      <div>
        <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>− {label}</div>
        {sublabel && <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{sublabel}</div>}
      </div>
      <div style={{ fontSize: 13, color: "var(--c-warning-text)", fontVariantNumeric: "tabular-nums" }}>
        − {fmt(amount, "currency", currency)}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)" }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

const card:  React.CSSProperties = { background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10 };
const empty: React.CSSProperties = { padding: 32, textAlign: "center", color: "var(--text-secondary)", fontSize: 13, ...card };
const input: React.CSSProperties = {
  background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 6,
  color: "var(--text-primary)", padding: "6px 12px", fontSize: 12, cursor: "pointer",
};
