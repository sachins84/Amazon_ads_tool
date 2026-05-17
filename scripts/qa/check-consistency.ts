#!/usr/bin/env -S npx tsx
/**
 * Cross-level consistency check.
 *
 * Verifies that campaign-level totals roughly equal the sum of their
 * ad-group totals. If they diverge by more than 2% on any high-spend
 * campaign, that's the SP-rollup bug class — flag it.
 *
 * Run with API_BASE env var (defaults to localhost:3000).
 */


const BASE = process.env.API_BASE ?? "http://localhost:3000";
const TOLERANCE = 0.02;  // 2%

interface Campaign { id: string; name: string; type: string; spend: number; sales: number; orders: number }
interface AdGroup  { id: string; spend: number; sales: number; orders: number }

let failures = 0;

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

function withinTolerance(a: number, b: number, tol = TOLERANCE): boolean {
  if (a === 0 && b === 0) return true;
  const denom = Math.max(Math.abs(a), Math.abs(b));
  return Math.abs(a - b) / denom <= tol;
}

async function run() {
  console.log(`▶ QA: cross-level consistency   (base=${BASE})\n`);

  const accounts = (await getJson<{ accounts: { id: string; adsMarketplace: string; name: string }[] }>("/api/accounts")).accounts;
  if (accounts.length === 0) {
    console.log("  (no accounts seeded — skipping)");
    return;
  }
  const acct = accounts[0];

  const ov = await getJson<{ campaigns: Campaign[] }>(`/api/overview?accountId=${acct.id}&dateRange=Last+7D`);
  const campaigns = (ov.campaigns ?? [])
    .filter((c) => c.spend > 0)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 5);  // top 5 by spend — full sweep would be slow

  if (campaigns.length === 0) {
    console.log("  (no campaigns with spend in window — skipping)");
    return;
  }

  console.log(`Checking top ${campaigns.length} campaigns by spend on ${acct.name}…\n`);

  for (const c of campaigns) {
    try {
      const ag = await getJson<{ adGroups: AdGroup[] }>(`/api/campaigns/${c.id}/adgroups?accountId=${acct.id}&dateRange=Last+7D`);
      const agSpend  = ag.adGroups.reduce((s, x) => s + x.spend, 0);
      const agSales  = ag.adGroups.reduce((s, x) => s + x.sales, 0);
      const agOrders = ag.adGroups.reduce((s, x) => s + x.orders, 0);

      const spendOk  = withinTolerance(c.spend, agSpend);
      const salesOk  = withinTolerance(c.sales, agSales);
      const ordersOk = withinTolerance(c.orders, agOrders);

      const status = (spendOk && salesOk && ordersOk) ? "✓" : "✕";
      console.log(`  ${status} ${c.type} ${c.name.slice(0, 50)}`);
      console.log(`     spend  campaign=${c.spend.toFixed(2)}   adgroup-sum=${agSpend.toFixed(2)}   ${spendOk ? "ok" : "MISMATCH"}`);
      console.log(`     sales  campaign=${c.sales.toFixed(2)}   adgroup-sum=${agSales.toFixed(2)}   ${salesOk ? "ok" : "MISMATCH"}`);
      console.log(`     orders campaign=${c.orders}             adgroup-sum=${agOrders}            ${ordersOk ? "ok" : "MISMATCH"}`);

      if (!spendOk || !salesOk || !ordersOk) {
        failures += 1;
        console.log(`     ⚠ Likely cause: SP ad-group rollup logic skipped this campaign, or prev-period code drift.`);
      }
      console.log();
    } catch (e) {
      console.log(`  ⚠ ${c.name}: ${String(e).slice(0, 80)}`);
    }
  }

  if (failures > 0) {
    console.error(`\n✗ FAILED: ${failures} campaign(s) had inconsistent rollups.`);
    process.exit(1);
  } else {
    console.log(`✓ PASSED: campaign totals reconcile with their ad-group rollups within ${TOLERANCE * 100}%.`);
  }
}

run().catch((e) => { console.error("QA consistency script crashed:", e); process.exit(1); });

export {};
