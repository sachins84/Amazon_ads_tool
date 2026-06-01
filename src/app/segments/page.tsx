"use client";
/**
 * /segments — spend / sales / ACOS / ROAS rollups by intent, program, and
 * the intent × program matrix. Designed for "where's my money going at
 * a portfolio level" decisions; ASIN-level rollup pending the
 * spAdvertisedProduct report wiring.
 */
import { useCallback, useEffect, useState } from "react";
import TopNav from "@/components/shared/TopNav";
import DataWindowBanner from "@/components/shared/DataWindowBanner";
import { useAccount } from "@/lib/account-context";
import { fmt } from "@/lib/utils";

type Row = {
  label: string;
  key: string;
  spend: number; sales: number; orders: number; clicks: number; impressions: number;
  acos: number | null; roas: number | null; ctr: number; cpc: number;
  spendShare: number; salesShare: number;
};

interface Resp {
  range: { startDate: string; endDate: string };
  total: Row;
  byIntent: Row[];
  byProgram: Row[];
  byIntentProgram: Array<{ intent: string; program: string } & Row>;
  byAsin: Array<{ asin: string } & Row>;
}

const PRESETS = ["Last 7D", "Last 14D", "Last 30D", "Last 60D"];

export default function SegmentsPage() {
  const { activeAccount } = useAccount();
  const accountId = activeAccount?.id ?? "";
  const currency  = activeAccount?.adsMarketplace === "IN" ? "INR" : "USD";

  const [preset, setPreset] = useState("Last 7D");
  const [data, setData]     = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) { setData(null); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/segments?accountId=${accountId}&dateRange=${encodeURIComponent(preset)}`, { cache: "no-store" });
      setData(await res.json());
    } finally { setLoading(false); }
  }, [accountId, preset]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-base)" }}>
      <TopNav />
      <main style={{ padding: "24px 28px", maxWidth: 1600, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>Segments</h1>
            <p style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
              {accountId ? `${activeAccount?.name} · ${currency}` : "Pick a brand"} · spend split by intent and program
            </p>
          </div>
          <select value={preset} onChange={(e) => setPreset(e.target.value)} style={input}>
            {PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        <div style={{ marginBottom: 12 }}>
          <DataWindowBanner accountId={accountId} window={`Segments rollup: ${preset}`} />
        </div>

        {!accountId ? (
          <div style={empty}>Pick a brand from the top-right dropdown.</div>
        ) : loading && !data ? (
          <div style={empty}>Loading…</div>
        ) : !data || data.total.spend === 0 ? (
          <div style={empty}>No spend in this window.</div>
        ) : (
          <>
            <TotalCard total={data.total} currency={currency} />

            <SegmentTable
              title="By intent (Brand · Comp · Generic · Auto · PAT)"
              rows={[...data.byIntent].sort((a, b) => b.spend - a.spend)}
              currency={currency}
            />

            <SegmentTable
              title="By program (SP · SB · SB Video · SD)"
              rows={[...data.byProgram].sort((a, b) => b.spend - a.spend)}
              currency={currency}
            />

            <SegmentTable
              title="Intent × Program (every cell with spend)"
              rows={[...data.byIntentProgram].sort((a, b) => b.spend - a.spend)}
              currency={currency}
            />

            {(data.byAsin?.length ?? 0) > 0 ? (
              <SegmentTable
                title={`By ASIN (top ${Math.min(50, data.byAsin.length)} by spend, ${data.byAsin.length} total)`}
                rows={data.byAsin.slice(0, 50)}
                currency={currency}
              />
            ) : (
              <div style={{ ...card, padding: 14, marginTop: 12, fontSize: 11, color: "var(--text-muted)" }}>
                ASIN-level rows will populate once the next /api/admin/refresh successfully completes — the spAdvertisedProduct report is now part of the daily pull.
                {" "}
                <span style={{ color: "var(--text-secondary)" }}>(API returned {data.byAsin?.length ?? "no"} byAsin rows for this brand × window)</span>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function TotalCard({ total, currency }: { total: Row; currency: string }) {
  return (
    <div style={{ ...card, padding: 14, marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
        Portfolio total
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12 }}>
        <Kpi label="Spend"    value={fmt(total.spend, "currency", currency)} />
        <Kpi label="Sales"    value={fmt(total.sales, "currency", currency)} />
        <Kpi label="Orders"   value={String(total.orders)} />
        <Kpi label="ACOS"     value={total.acos != null ? `${total.acos.toFixed(1)}%` : "—"} />
        <Kpi label="ROAS"     value={total.roas != null ? `${total.roas.toFixed(2)}x` : "—"} />
        <Kpi label="CPC"      value={fmt(total.cpc, "currency", currency)} />
      </div>
    </div>
  );
}

function SegmentTable({ title, rows, currency }: { title: string; rows: Row[]; currency: string }) {
  const maxSpend = Math.max(...rows.map((r) => r.spend), 1);
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}>{title}</div>
      <div style={card}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                <Th align="left">Segment</Th>
                <Th align="right">Spend</Th>
                <Th align="right">% of spend</Th>
                <Th align="right">Sales</Th>
                <Th align="right">Orders</Th>
                <Th align="right">ACOS</Th>
                <Th align="right">ROAS</Th>
                <Th align="right">CTR</Th>
                <Th align="right">CPC</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} style={{ borderBottom: "1px solid var(--bg-input)" }}>
                  <td style={{ padding: "8px 8px", color: "var(--text-primary)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ minWidth: 180 }}>{r.label}</span>
                      <span style={{
                        position: "relative", height: 8, width: 120,
                        background: "var(--bg-input)", borderRadius: 4,
                      }}>
                        <span style={{
                          position: "absolute", left: 0, top: 0, bottom: 0,
                          width: `${(r.spend / maxSpend) * 100}%`,
                          background: "linear-gradient(90deg,#6366f1,#8b5cf6)",
                          borderRadius: 4,
                        }} />
                      </span>
                    </div>
                  </td>
                  <td style={tdR}>{fmt(r.spend, "currency", currency)}</td>
                  <td style={{ ...tdR, color: "var(--text-secondary)" }}>{r.spendShare.toFixed(1)}%</td>
                  <td style={tdR}>{fmt(r.sales, "currency", currency)}</td>
                  <td style={tdR}>{Math.round(r.orders)}</td>
                  <td style={{ ...tdR, color: acosColor(r.acos) }}>{r.acos != null ? `${r.acos.toFixed(1)}%` : "—"}</td>
                  <td style={tdR}>{r.roas != null ? `${r.roas.toFixed(2)}x` : "—"}</td>
                  <td style={{ ...tdR, color: "var(--text-secondary)" }}>{r.ctr.toFixed(2)}%</td>
                  <td style={{ ...tdR, color: "var(--text-secondary)" }}>{fmt(r.cpc, "currency", currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function acosColor(acos: number | null): string {
  if (acos == null) return "var(--text-muted)";
  if (acos < 25) return "var(--c-success-text)";
  if (acos < 50) return "var(--text-primary)";
  return "var(--c-danger-text)";
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <th style={{ textAlign: align, padding: "8px 8px", fontWeight: 500, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>{children}</th>;
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: 16, color: "var(--text-primary)", marginTop: 2, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

const card:  React.CSSProperties = { background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: 4 };
const empty: React.CSSProperties = { padding: 32, textAlign: "center", color: "var(--text-secondary)", fontSize: 12, ...card };
const tdR:   React.CSSProperties = { padding: "8px 8px", textAlign: "right", color: "var(--text-primary)", whiteSpace: "nowrap" };
const input: React.CSSProperties = {
  background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 6,
  color: "var(--text-primary)", padding: "6px 12px", fontSize: 12, cursor: "pointer",
};
