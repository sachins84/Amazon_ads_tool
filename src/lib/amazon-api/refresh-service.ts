/**
 * Incremental refresh: pulls trailing N days from Amazon, upserts into the
 * metrics store. Used by the daily 8 AM cron + the dashboard refresh button.
 *
 * Default window: 14 days. That covers Amazon's attribution backfill — older
 * data won't change, so we never re-pull it.
 */
import { getAccount } from "@/lib/db/accounts";
import {
  upsertCampaignMetrics, upsertAdGroupMetrics, upsertTargetingMetrics,
  upsertCampaignMeta,    upsertAdGroupMeta,    upsertTargetingMeta,
  setRefreshState,
  type CampaignDailyRow, type AdGroupDailyRow, type TargetingDailyRow,
  type CampaignMetaRow,  type AdGroupMetaRow,  type TargetingMetaRow,
} from "@/lib/db/metrics-store";
import { listAllCampaigns }      from "./campaigns";
import { listAllAdGroups }       from "./adgroups";
import { listSPKeywords, listSPProductTargets } from "./targeting";
import {
  fetchAllProgramReports, fetchAllAdGroupReports, fetchTargetingReport,
  type Program,
} from "./reports";

export interface RefreshResult {
  accountId: string;
  brandName: string;
  windowStart: string;
  windowEnd:   string;
  campaignRowsUpserted:  number;
  adGroupRowsUpserted:   number;
  targetingRowsUpserted: number;
  campaignMetaUpserted:  number;
  adGroupMetaUpserted:   number;
  targetingMetaUpserted: number;
  durationMs: number;
  errors: { program: Program; error: string; phase: RefreshPhase }[];
}

type RefreshPhase =
  | "campaigns" | "adgroups" | "targeting"
  | "list_campaigns" | "list_adgroups" | "list_keywords" | "list_targets";

export async function refreshAccountRecent(accountId: string, days = 21): Promise<RefreshResult> {
  const acct = getAccount(accountId);
  if (!acct) throw new Error(`Account ${accountId} not found`);

  const start = Date.now();
  const windowEnd = todayUTC();
  const windowStart = daysAgoUTC(days);
  const errors: RefreshResult["errors"] = [];

  // ─── 1. Fetch everything in parallel ───────────────────────────────────
  const [campaignsResult, adGroupsResult, keywordsResult, productTargetsResult,
         campaignReports, adGroupReports, targetingReport] = await Promise.all([
    listAllCampaigns(acct.adsProfileId, accountId).catch((e) => {
      errors.push({ program: "SP", error: String(e), phase: "list_campaigns" });
      return { campaigns: [], errors: [] };
    }),
    listAllAdGroups(acct.adsProfileId, undefined, accountId).catch((e) => {
      errors.push({ program: "SP", error: String(e), phase: "list_adgroups" });
      return { adGroups: [], errors: [] };
    }),
    listSPKeywords(acct.adsProfileId, {}, accountId).catch((e) => {
      errors.push({ program: "SP", error: String(e), phase: "list_keywords" });
      return [];
    }),
    listSPProductTargets(acct.adsProfileId, {}, accountId).catch((e) => {
      errors.push({ program: "SP", error: String(e), phase: "list_targets" });
      return [];
    }),
    fetchAllProgramReports(acct.adsProfileId, windowStart, windowEnd, accountId).catch((e) => {
      errors.push({ program: "SP", error: String(e), phase: "campaigns" });
      return { rows: [], errors: [] };
    }),
    fetchAllAdGroupReports(acct.adsProfileId, windowStart, windowEnd, accountId).catch((e) => {
      errors.push({ program: "SP", error: String(e), phase: "adgroups" });
      return { rows: [], errors: [] };
    }),
    fetchTargetingReport(acct.adsProfileId, windowStart, windowEnd, accountId).catch((e) => {
      errors.push({ program: "SP", error: String(e), phase: "targeting" });
      return [] as Record<string, unknown>[];
    }),
  ]);

  for (const e of campaignsResult.errors) errors.push({ program: e.program, error: e.error, phase: "list_campaigns" });
  for (const e of adGroupsResult.errors)  errors.push({ program: e.program, error: e.error, phase: "list_adgroups" });
  for (const e of campaignReports.errors) errors.push({ program: e.program, error: e.error, phase: "campaigns" });
  for (const e of adGroupReports.errors)  errors.push({ program: e.program, error: e.error, phase: "adgroups" });

  // ─── 2. Upsert metadata + daily metrics ────────────────────────────────
  const campaignMeta: CampaignMetaRow[] = campaignsResult.campaigns.map((c) => ({
    accountId, campaignId: c.campaignId, program: c.program,
    name: c.name, state: c.state,
    dailyBudget: c.dailyBudget,
    portfolioId: c.portfolioId ?? null,
    targetingType: c.targetingType ?? null,
    brandEntityId: c.brandEntityId ?? null,
  }));

  const campaignDaily: CampaignDailyRow[] = campaignReports.rows
    .filter((r) => r.date)
    .map((r) => ({
      accountId, campaignId: r.campaignId, date: r.date, program: r.program,
      impressions: r.impressions, clicks: r.clicks, cost: r.cost, orders: r.orders, sales: r.sales,
    }));

  const adGroupMeta: AdGroupMetaRow[] = adGroupsResult.adGroups.map((ag) => ({
    accountId, adGroupId: ag.adGroupId, campaignId: ag.campaignId, program: ag.program,
    name: ag.name, state: ag.state, defaultBid: ag.defaultBid,
  }));

  const adGroupDaily: AdGroupDailyRow[] = adGroupReports.rows
    .filter((r) => r.date && r.adGroupId)
    .map((r) => ({
      accountId, campaignId: r.campaignId, adGroupId: r.adGroupId, adGroupName: r.adGroupName,
      date: r.date, program: r.program,
      impressions: r.impressions, clicks: r.clicks, cost: r.cost, orders: r.orders, sales: r.sales,
    }));

  // ─── 3. Targeting meta + daily ──────────────────────────────────────────
  const targetingMeta: TargetingMetaRow[] = [
    ...keywordsResult.map((k) => ({
      accountId, targetId: k.keywordId,
      campaignId: k.campaignId, adGroupId: k.adGroupId,
      program: "SP" as Program, kind: "KEYWORD" as const,
      display: k.keywordText,
      matchType: k.matchType,
      state: k.state, bid: k.bid ?? null,
    })),
    ...productTargetsResult.map((t) => {
      const expr = t.expression?.[0] ?? t.resolvedExpression?.[0];
      // Auto-targeting expressions Amazon returns:
      //   queryHighRelMatches    = close match
      //   queryBroadRelMatches   = loose match
      //   asinSubstituteRelated  = substitutes
      //   asinAccessoryRelated   = complements
      const isAuto = expr ? AUTO_EXPRESSION_TYPES.has(String(expr.type)) : t.expressionType === "AUTO";
      const display = isAuto && expr
        ? autoLabel(String(expr.type))
        : expr
          ? (expr.type === "asinSameAs" ? `ASIN: ${expr.value}` : `${expr.type}${expr.value ? `: ${expr.value}` : ""}`)
          : "Auto target";
      return {
        accountId, targetId: t.targetId,
        campaignId: t.campaignId, adGroupId: t.adGroupId,
        program: "SP" as Program,
        kind: (isAuto ? "AUTO" : "PRODUCT_TARGET") as TargetingMetaRow["kind"],
        display,
        matchType: null,
        state: t.state, bid: t.bid ?? null,
      };
    }),
  ];

  // Index meta by id so we can attach display/matchType to daily rows.
  const metaById = new Map(targetingMeta.map((m) => [m.targetId, m]));

  const targetingDaily: TargetingDailyRow[] = (targetingReport as Record<string, unknown>[])
    .filter((r) => r.keywordId && r.date && r.adGroupId)
    .map((r) => {
      const id = String(r.keywordId);
      const m = metaById.get(id);
      return {
        accountId,
        campaignId: String(r.campaignId ?? m?.campaignId ?? ""),
        adGroupId:  String(r.adGroupId  ?? m?.adGroupId  ?? ""),
        targetId:   id,
        date:       String(r.date),
        program:    "SP" as Program,
        kind:       (m?.kind ?? (r.keywordType ? deriveKind(String(r.keywordType)) : null)) as TargetingDailyRow["kind"],
        matchType:  (m?.matchType ?? null),
        display:    (m?.display ?? String(r.targeting ?? r.keyword ?? "") ?? null),
        impressions: Number(r.impressions ?? 0),
        clicks:      Number(r.clicks ?? 0),
        cost:        Number(r.cost ?? 0),
        orders:      Number(r.purchases7d ?? r.purchases30d ?? 0),
        sales:       Number(r.sales7d ?? r.sales30d ?? 0),
      };
    });

  const campaignMetaUpserted  = upsertCampaignMeta(campaignMeta);
  const campaignRowsUpserted  = upsertCampaignMetrics(campaignDaily);
  const adGroupMetaUpserted   = upsertAdGroupMeta(adGroupMeta);
  const adGroupRowsUpserted   = upsertAdGroupMetrics(adGroupDaily);
  const targetingMetaUpserted = upsertTargetingMeta(targetingMeta);
  const targetingRowsUpserted = upsertTargetingMetrics(targetingDaily);

  const durationMs = Date.now() - start;
  const lastRefreshAt = new Date().toISOString();

  setRefreshState({
    accountId, level: "campaigns",
    lastRefreshAt, windowStart, windowEnd,
    rowsUpserted: campaignRowsUpserted,
    durationMs,
    error: errors.filter((e) => e.phase === "campaigns" || e.phase === "list_campaigns").map((e) => `${e.program}/${e.phase}: ${e.error.slice(0, 80)}`).join("; ") || null,
  });
  setRefreshState({
    accountId, level: "adgroups",
    lastRefreshAt, windowStart, windowEnd,
    rowsUpserted: adGroupRowsUpserted,
    durationMs,
    error: errors.filter((e) => e.phase === "adgroups" || e.phase === "list_adgroups").map((e) => `${e.program}/${e.phase}: ${e.error.slice(0, 80)}`).join("; ") || null,
  });
  setRefreshState({
    accountId, level: "targeting",
    lastRefreshAt, windowStart, windowEnd,
    rowsUpserted: targetingRowsUpserted,
    durationMs,
    error: errors.filter((e) => e.phase === "targeting" || e.phase === "list_keywords" || e.phase === "list_targets").map((e) => `${e.program}/${e.phase}: ${e.error.slice(0, 80)}`).join("; ") || null,
  });

  return {
    accountId,
    brandName: acct.name,
    windowStart, windowEnd,
    campaignRowsUpserted,
    adGroupRowsUpserted,
    targetingRowsUpserted,
    campaignMetaUpserted,
    adGroupMetaUpserted,
    targetingMetaUpserted,
    durationMs,
    errors,
  };
}

function deriveKind(keywordType: string): TargetingDailyRow["kind"] {
  const t = keywordType.toUpperCase();
  if (t === "BROAD" || t === "EXACT" || t === "PHRASE" || t === "KEYWORD") return "KEYWORD";
  if (t.includes("AUTO")) return "AUTO";
  return "PRODUCT_TARGET";
}

const AUTO_EXPRESSION_TYPES = new Set([
  "queryHighRelMatches",
  "queryBroadRelMatches",
  "asinSubstituteRelated",
  "asinAccessoryRelated",
]);

function autoLabel(type: string): string {
  return {
    queryHighRelMatches:   "Auto · close-match",
    queryBroadRelMatches:  "Auto · loose-match",
    asinSubstituteRelated: "Auto · substitutes",
    asinAccessoryRelated:  "Auto · complements",
  }[type] ?? `Auto · ${type}`;
}

// ─── Date helpers (UTC, YYYY-MM-DD) ─────────────────────────────────────────

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoUTC(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
