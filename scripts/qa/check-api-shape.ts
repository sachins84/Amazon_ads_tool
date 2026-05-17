#!/usr/bin/env -S npx tsx
/**
 * Verifies that every API endpoint returns the fields the UI reads.
 *
 * Run with the dev server running locally (npm run dev), or against any
 * live deployment via API_BASE env var:
 *   API_BASE=https://amz-ads.mosaicwellness.in npx tsx scripts/qa/check-api-shape.ts
 *
 * Exits non-zero on any failure so CI marks the build red.
 */


const BASE = process.env.API_BASE ?? "http://localhost:3000";

interface Result { name: string; ok: boolean; message?: string }
const results: Result[] = [];
let failures = 0;

function check(name: string, predicate: boolean, message?: string) {
  results.push({ name, ok: predicate, message });
  if (!predicate) failures += 1;
}

async function getJson(path: string): Promise<unknown> {
  const url = `${BASE}${path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

function hasField(obj: unknown, path: string): boolean {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return false;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur !== undefined;
}

function isNumberField(obj: unknown, path: string): boolean {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return false;
    cur = (cur as Record<string, unknown>)[p];
  }
  return typeof cur === "number" && !isNaN(cur);
}

async function run() {
  console.log(`▶ QA: API shape   (base=${BASE})\n`);

  // 1. /api/accounts
  console.log("• /api/accounts");
  let acctList: Array<{ id: string; adsMarketplace: string; name: string }>;
  try {
    const r = await getJson("/api/accounts") as { accounts: typeof acctList };
    acctList = r.accounts ?? [];
    check("accounts.accounts is an array", Array.isArray(acctList));
    check("at least 1 account exists", acctList.length > 0,
      "no accounts seeded; run the seed steps in SETUP.md or POST to /api/accounts");
  } catch (e) {
    check("accounts list reachable", false, String(e));
    fail(); return;
  }

  if (acctList.length === 0) { fail(); return; }
  const acct = acctList[0];

  // 2. /api/overview
  console.log(`• /api/overview?accountId=${acct.id}&dateRange=Last+7D`);
  try {
    const ov = await getJson(`/api/overview?accountId=${acct.id}&dateRange=Last+7D`);

    // KPI shape — the prev-bug regression test.
    for (const kpi of ["spend","sales","orders","roas","acos","ctr","cpc","cvr","impressions","clicks"]) {
      check(`overview.kpis.${kpi}.value exists`, isNumberField(ov, `kpis.${kpi}.value`),
        `kpis.${kpi} is missing 'value' — UI will display 0`);
      check(`overview.kpis.${kpi}.prev exists (vs-prev deltas need this)`, hasField(ov, `kpis.${kpi}.prev`),
        `kpis.${kpi} is missing 'prev' — KpiCard will show 'no comparison (server needs rebuild)'`);
    }

    check("overview.campaigns is an array", Array.isArray((ov as { campaigns?: unknown }).campaigns));
    check("overview.spendByType is an array", Array.isArray((ov as { spendByType?: unknown }).spendByType));
    check("overview.dailySeries is an array", Array.isArray((ov as { dailySeries?: unknown }).dailySeries));
    check("overview.freshness exists", hasField(ov, "freshness.lastRefreshAt") || hasField(ov, "freshness.stale"));

    // Per-row shape — the row-level prev regression test.
    const camps = (ov as { campaigns: Array<Record<string, unknown>> }).campaigns;
    if (camps.length > 0) {
      const c = camps[0];
      for (const f of ["id","name","type","status","spend","sales","orders","roas","acos","ctr","intent"]) {
        check(`overview.campaigns[0].${f} present`, c[f] !== undefined, `campaigns row missing ${f}`);
      }
      // Row-level prev: optional, but if any campaign has spend > 0 and we have refresh data,
      // at least one row in the response should carry `prev`.
      const anyHasPrev = camps.some((r) => r.prev !== undefined);
      check("at least one campaign row carries 'prev' (row-level deltas)", anyHasPrev,
        "no row has prev — refresh window too narrow OR overview-service not attaching per-campaign prev");
    } else {
      check("campaigns array populated (data freshness)", false,
        "no campaigns in response. Either no data refreshed yet, or filter is hiding everything.");
    }
  } catch (e) {
    check("/api/overview reachable", false, String(e));
  }

  // 3. /api/targeting
  console.log(`• /api/targeting?accountId=${acct.id}&dateRange=Last+7D`);
  try {
    const tg = await getJson(`/api/targeting?accountId=${acct.id}&dateRange=Last+7D&pageSize=5`) as {
      targets?: unknown[]; summary?: unknown; totalCount?: number;
    };
    check("targeting.targets is array", Array.isArray(tg.targets));
    check("targeting.summary exists", tg.summary != null);
    check("targeting.totalCount is number", typeof tg.totalCount === "number");
  } catch (e) {
    check("/api/targeting reachable", false, String(e));
  }

  // 4. /api/admin/refresh (state)
  console.log(`• /api/admin/refresh (state)`);
  try {
    const st = await getJson(`/api/admin/refresh`) as { states?: unknown[] };
    check("refresh state endpoint returns states array", Array.isArray(st.states));
  } catch (e) {
    check("/api/admin/refresh reachable", false, String(e));
  }

  // 5. /api/version
  console.log(`• /api/version`);
  try {
    const v = await getJson(`/api/version`) as { commit?: string };
    check("/api/version returns a commit", typeof v.commit === "string" && v.commit.length > 0);
  } catch (e) {
    check("/api/version reachable", false, String(e));
  }

  // ─── Report ───
  console.log();
  for (const r of results) {
    console.log(`${r.ok ? "  ✓" : "  ✕"} ${r.name}${r.message ? "  — " + r.message : ""}`);
  }
  console.log();
  if (failures > 0) {
    console.error(`✗ FAILED: ${failures} check(s) failed.`);
    process.exit(1);
  } else {
    console.log(`✓ PASSED: ${results.length} checks.`);
  }
}

function fail() {
  for (const r of results) {
    console.log(`${r.ok ? "  ✓" : "  ✕"} ${r.name}${r.message ? "  — " + r.message : ""}`);
  }
  console.error(`✗ FAILED early.`);
  process.exit(1);
}

run().catch((e) => {
  console.error("QA api-shape script crashed:", e);
  process.exit(1);
});

export {};
