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
  upsertPlacementMetrics, upsertAdvertisedProductMetrics,
  upsertBidRecommendations, readTargetingMeta, readAdvertisedProductMetrics,
  setRefreshState,
  type CampaignDailyRow, type AdGroupDailyRow, type TargetingDailyRow,
  type CampaignMetaRow,  type AdGroupMetaRow,  type TargetingMetaRow,
  type PlacementDailyRow, type AdvertisedProductDailyRow,
  type BidRecommendationRow,
} from "@/lib/db/metrics-store";
import { listAllCampaigns }      from "./campaigns";
import { listAllAdGroups }       from "./adgroups";
import { listSPKeywords, listSPProductTargets, getSPBidRecommendations } from "./targeting";
import { fetchAllOrdersReportCached, type AllOrdersItemRow } from "@/lib/sp-api/all-orders-report";
import { upsertAsinWarehouseDaily, type AsinWarehouseDailyRow } from "@/lib/db/asin-warehouse-store";
import { brandKeyFromAccountName, inferBrandFromTitle } from "@/lib/sp-api/brand-split-sales";
import {
  fetchAllProgramReports, fetchAllAdGroupReports, fetchTargetingReport,
  fetchSPPlacementReport, fetchSPAdvertisedProductReport,
  type Program, type PlacementRow, type AdvertisedProductRow,
} from "./reports";
import { captureOutcomesForAccount } from "@/lib/rules/outcome-capture";

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
  | "campaigns" | "adgroups" | "targeting" | "placement" | "advertised_product"
  | "list_campaigns" | "list_adgroups" | "list_keywords" | "list_targets"
  | "bid_recs"
  | "asin_warehouse";

/** Cap on how many ad groups we fetch bid recommendations for per refresh.
 *  The API caps each request to one ad group, so volume = N ad groups × ~1s
 *  serial. India brands routinely have 1000+ ad groups, so 200 left most
 *  keywords with no recommendation in the UI. 1000 covers the long tail while
 *  staying inside the rate budget (a ~15 min refresh window). Sorted by SP
 *  spend so the highest-impact ad groups always make the cut. */
const BID_REC_AD_GROUP_CAP = 1000;

export async function refreshAccountRecent(accountId: string, days = 21): Promise<RefreshResult> {
  const acct = getAccount(accountId);
  if (!acct) throw new Error(`Account ${accountId} not found`);

  const start = Date.now();
  const windowEnd = todayUTC();
  const windowStart = daysAgoUTC(days);
  const errors: RefreshResult["errors"] = [];

  // ─── 1. Fetch everything in parallel ───────────────────────────────────
  const [campaignsResult, adGroupsResult, keywordsResult, productTargetsResult,
         campaignReports, adGroupReports, targetingReport, placementReport,
         advertisedProductReport] = await Promise.all([
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
    // Reports API caps each request at ~31 days. For larger windows we
    // chunk into ≤30-day slices and run them serially per report type
    // (the three TYPES still parallelise across types).
    chunkedFetch(windowStart, windowEnd, (s, e) =>
      fetchAllProgramReports(acct.adsProfileId, s, e, accountId),
      (a, b) => ({ rows: [...a.rows, ...b.rows], errors: [...a.errors, ...b.errors] }),
      { rows: [], errors: [] },
    ).catch((e) => {
      errors.push({ program: "SP", error: String(e), phase: "campaigns" });
      return { rows: [], errors: [] };
    }),
    chunkedFetch(windowStart, windowEnd, (s, e) =>
      fetchAllAdGroupReports(acct.adsProfileId, s, e, accountId),
      (a, b) => ({ rows: [...a.rows, ...b.rows], errors: [...a.errors, ...b.errors] }),
      { rows: [], errors: [] },
    ).catch((e) => {
      errors.push({ program: "SP", error: String(e), phase: "adgroups" });
      return { rows: [], errors: [] };
    }),
    chunkedFetch(windowStart, windowEnd, (s, e) =>
      fetchTargetingReport(acct.adsProfileId, s, e, accountId),
      (a, b) => [...a, ...b],
      [] as Record<string, unknown>[],
    ).catch((e) => {
      errors.push({ program: "SP", error: String(e), phase: "targeting" });
      return [] as Record<string, unknown>[];
    }),
    // SP placement breakdown — only SP exposes this. Same chunking story.
    // Non-fatal if it 400s on accounts that don't have placement data yet.
    chunkedFetch(windowStart, windowEnd, (s, e) =>
      fetchSPPlacementReport(acct.adsProfileId, s, e, accountId),
      (a, b) => [...a, ...b],
      [] as PlacementRow[],
    ).catch((e) => {
      errors.push({ program: "SP", error: String(e), phase: "placement" });
      return [] as PlacementRow[];
    }),
    // SP per-ASIN report — drives the ASIN rollup on /segments.
    chunkedFetch(windowStart, windowEnd, (s, e) =>
      fetchSPAdvertisedProductReport(acct.adsProfileId, s, e, accountId),
      (a, b) => [...a, ...b],
      [] as AdvertisedProductRow[],
    ).catch((e) => {
      errors.push({ program: "SP", error: String(e), phase: "advertised_product" });
      return [] as AdvertisedProductRow[];
    }),
  ]);

  for (const e of campaignsResult.errors) errors.push({ program: e.program, error: e.error, phase: "list_campaigns" });
  for (const e of adGroupsResult.errors)  errors.push({ program: e.program, error: e.error, phase: "list_adgroups" });
  for (const e of campaignReports.errors) errors.push({ program: e.program, error: e.error, phase: "campaigns" });
  for (const e of adGroupReports.errors)  errors.push({ program: e.program, error: e.error, phase: "adgroups" });

  // Diagnostic: surface what each list endpoint returned even when no
  // exception was thrown. An account with previously-large campaign counts
  // suddenly getting 0/24 entries (BeBodywise on 2026-06-01) is a silent
  // failure that would otherwise leave the refresh-state error column
  // empty. These diagnostic rows go into the same error column so it shows
  // up in /api/admin/refresh.
  const spCamps = campaignsResult.campaigns.filter((c) => c.program === "SP").length;
  const sbCamps = campaignsResult.campaigns.filter((c) => c.program === "SB").length;
  const sdCamps = campaignsResult.campaigns.filter((c) => c.program === "SD").length;
  const spAg    = adGroupsResult.adGroups.filter((a) => a.program === "SP").length;
  const sbAg    = adGroupsResult.adGroups.filter((a) => a.program === "SB").length;
  const sdAg    = adGroupsResult.adGroups.filter((a) => a.program === "SD").length;
  const tgRows  = (targetingReport as Record<string, unknown>[]).length;
  const kwCount = keywordsResult.length;
  const ptCount = productTargetsResult.length;
  // Report-row breakdown per program — catches the BeBodywise case where the
  // ad listings work but Amazon's Reports API returns 0 rows for some/all programs.
  const cReportSP = campaignReports.rows.filter((r) => r.program === "SP").length;
  const cReportSB = campaignReports.rows.filter((r) => r.program === "SB").length;
  const cReportSD = campaignReports.rows.filter((r) => r.program === "SD").length;
  const agReportSP = adGroupReports.rows.filter((r) => r.program === "SP").length;
  const agReportSB = adGroupReports.rows.filter((r) => r.program === "SB").length;
  const agReportSD = adGroupReports.rows.filter((r) => r.program === "SD").length;
  const placementRowCount = placementReport.length;
  const advertisedProductRowCount = advertisedProductReport.length;
  errors.push({
    program: "SP",
    error: `LIST_COUNTS: SP/SB/SD camps=${spCamps}/${sbCamps}/${sdCamps} ags=${spAg}/${sbAg}/${sdAg} | REPORTS: camp=${cReportSP}/${cReportSB}/${cReportSD} ag=${agReportSP}/${agReportSB}/${agReportSD} tgt=${tgRows} place=${placementRowCount} ap=${advertisedProductRowCount} | listSP: kw=${kwCount} pt=${ptCount}`,
    phase: "list_campaigns",
  });

  // ─── 2. Upsert metadata + daily metrics ────────────────────────────────
  const campaignMeta: CampaignMetaRow[] = campaignsResult.campaigns.map((c) => ({
    accountId, campaignId: c.campaignId, program: c.program,
    name: c.name, state: c.state,
    dailyBudget: c.dailyBudget,
    portfolioId: c.portfolioId ?? null,
    targetingType: c.targetingType ?? null,
    brandEntityId: c.brandEntityId ?? null,
    format: c.format,
  }));

  const campaignDaily: CampaignDailyRow[] = campaignReports.rows
    .filter((r) => r.date)
    .map((r) => ({
      accountId, campaignId: r.campaignId, date: r.date, program: r.program,
      impressions: r.impressions, clicks: r.clicks, cost: r.cost, orders: r.orders, sales: r.sales,
      topOfSearchIS: r.topOfSearchIS,
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

  const placementDaily: PlacementDailyRow[] = placementReport.map((r) => ({
    accountId,
    campaignId: r.campaignId,
    date: r.date,
    placement: r.placement,
    impressions: r.impressions,
    clicks: r.clicks,
    cost: r.cost,
    orders: r.orders,
    sales: r.sales,
  }));

  const advertisedProductDaily: AdvertisedProductDailyRow[] = advertisedProductReport.map((r) => ({
    accountId,
    campaignId: r.campaignId,
    adGroupId: r.adGroupId,
    asin: r.asin,
    date: r.date,
    impressions: r.impressions,
    clicks: r.clicks,
    cost: r.cost,
    orders: r.orders,
    sales: r.sales,
  }));

  const campaignMetaUpserted  = upsertCampaignMeta(campaignMeta);
  const campaignRowsUpserted  = upsertCampaignMetrics(campaignDaily);
  const adGroupMetaUpserted   = upsertAdGroupMeta(adGroupMeta);
  const adGroupRowsUpserted   = upsertAdGroupMetrics(adGroupDaily);
  const targetingMetaUpserted = upsertTargetingMeta(targetingMeta);
  const targetingRowsUpserted = upsertTargetingMetrics(targetingDaily);
  const placementRowsUpserted = upsertPlacementMetrics(placementDaily);
  const advertisedProductRowsUpserted = upsertAdvertisedProductMetrics(advertisedProductDaily);
  void placementRowsUpserted; void advertisedProductRowsUpserted;
  // (Both surfaced via refresh state error column when zero; not in RefreshResult.)

  // ─── 4. Bid recommendations (SP only, best-effort) ──────────────────────
  // Run AFTER advertised_product upsert: the rec endpoint requires the ASINs
  // currently advertised in the ad group, which we just refreshed.
  //
  // Use the just-persisted targeting_meta rather than the in-flight
  // `targetingMeta` variable: on some accounts (Vendor SP particularly)
  // `listSPKeywords` occasionally returns an empty page mid-refresh, which
  // would silently leave bid_recs at 0 even though the DB still has the
  // previous run's keywords. Reading from the DB after upsert means we
  // always work with the most authoritative state we have for this account.
  const persistedTargetingMeta = readTargetingMeta(accountId);
  // ASINs come from the advertised-product report, which only has rows for
  // ad-groups with recent spend. Paused ad-groups have no recent ASINs in the
  // 14-day window — pull from a wider 90-day window so paused-recently
  // campaigns still have ASIN data we can drive the bid-rec request with.
  // Anything paused longer than 90 days simply gets no rec (rare in practice).
  const persistedAsins = readAdvertisedProductMetrics(accountId, daysAgoUTC(90), windowEnd);
  const bidRecRowsUpserted = await syncBidRecommendations({
    accountId,
    profileId: acct.adsProfileId,
    targetingMeta: persistedTargetingMeta,
    targetingDaily,
    advertisedProductRows: persistedAsins,
    errors,
  });

  // ─── 5. ASIN × warehouse from SP-API All Orders (Seller-side, optional) ──
  // Only runs when spMarketplaceId is configured on the account. Powers the
  // /asin-warehouse tab. Non-fatal — failures here don't block the refresh.
  const asinWarehouseRowsUpserted = acct.spMarketplaceId
    ? await syncAsinWarehouseDaily({
        accountId,
        accountName: acct.name,
        marketplaceId: acct.spMarketplaceId,
        windowStart,
        windowEnd,
        errors,
      })
    : 0;

  const durationMs = Date.now() - start;
  const lastRefreshAt = new Date().toISOString();

  setRefreshState({
    accountId, level: "campaigns",
    lastRefreshAt, windowStart, windowEnd,
    rowsUpserted: campaignRowsUpserted,
    durationMs,
    error: errors.filter((e) => e.phase === "campaigns" || e.phase === "list_campaigns").map((e) => `${e.program}/${e.phase}: ${e.error.slice(0, 400)}`).join("; ") || null,
  });
  setRefreshState({
    accountId, level: "adgroups",
    lastRefreshAt, windowStart, windowEnd,
    rowsUpserted: adGroupRowsUpserted,
    durationMs,
    error: errors.filter((e) => e.phase === "adgroups" || e.phase === "list_adgroups").map((e) => `${e.program}/${e.phase}: ${e.error.slice(0, 400)}`).join("; ") || null,
  });
  setRefreshState({
    accountId, level: "targeting",
    lastRefreshAt, windowStart, windowEnd,
    rowsUpserted: targetingRowsUpserted,
    durationMs,
    error: errors.filter((e) => e.phase === "targeting" || e.phase === "list_keywords" || e.phase === "list_targets").map((e) => `${e.program}/${e.phase}: ${e.error.slice(0, 400)}`).join("; ") || null,
  });
  setRefreshState({
    accountId, level: "bid_recs",
    lastRefreshAt, windowStart, windowEnd,
    rowsUpserted: bidRecRowsUpserted,
    durationMs,
    error: errors.filter((e) => e.phase === "bid_recs").map((e) => `${e.program}/${e.phase}: ${e.error.slice(0, 400)}`).join("; ") || null,
  });
  setRefreshState({
    accountId, level: "asin_warehouse",
    lastRefreshAt, windowStart, windowEnd,
    rowsUpserted: asinWarehouseRowsUpserted,
    durationMs,
    error: errors.filter((e) => e.phase === "asin_warehouse").map((e) => `${e.program}/${e.phase}: ${e.error.slice(0, 400)}`).join("; ") || null,
  });

  // ─── Outcome capture ─────────────────────────────────────────────────
  // Now that fresh metrics are in the store, score any APPLIED suggestions
  // whose after-windows have just become measurable. Cheap (reads only the
  // tiny APPLIED set + already-pulled daily rows); failures are non-fatal.
  try {
    captureOutcomesForAccount(accountId);
  } catch (err) {
    console.error(`[refresh] outcome-capture ${accountId} failed:`, String(err));
  }

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

/**
 * Best-effort: call the SP Theme-Based Bid Recommendations API once per
 * ad group (capped at BID_REC_AD_GROUP_CAP highest-spend groups) and persist
 * the returned (low/median/high) tuple per target. Failures on a single ad
 * group are non-fatal — we just skip that group's targets so the optimiser
 * sees `null` recommendations and treats them as "unknown, ignore".
 */
/**
 * Pull the SP-API All Orders flat-file report, aggregate by
 * (date × asin × ship_city × ship_state), and upsert. Best-effort: any
 * error gets recorded under phase "asin_warehouse" and 0 rows are written.
 *
 * Only runs when the account has spMarketplaceId set — call site already
 * gates on this.
 */
async function syncAsinWarehouseDaily(args: {
  accountId: string;
  accountName: string;
  marketplaceId: string;
  windowStart: string;
  windowEnd: string;
  errors: RefreshResult["errors"];
}): Promise<number> {
  let items: AllOrdersItemRow[];
  try {
    // Same Seller Central + same marketplace = same report across all 4
    // brand-refreshes — the cached fetcher dedupes concurrent calls and
    // memoises for 10 min so the report only gets generated once.
    items = await fetchAllOrdersReportCached(args.marketplaceId, args.windowStart, args.windowEnd);
  } catch (e) {
    args.errors.push({ program: "SP", error: String(e).slice(0, 300), phase: "asin_warehouse" });
    return 0;
  }

  // One Seller Central authorization spans all 4 brands' ASINs — filter the
  // report to rows that match THIS brand by title pattern (manmatters /
  // bebodywise / littlejoys). Falls back to the full report if the account
  // name doesn't carry a brand token (defensive — shouldn't happen on prod).
  const brandKey = brandKeyFromAccountName(args.accountName);
  if (brandKey) {
    const before = items.length;
    items = items.filter((it) => inferBrandFromTitle(it.itemName) === brandKey);
    args.errors.push({
      program: "SP",
      error: `BRAND_FILTER: ${args.accountName} matched brand=${brandKey}, kept ${items.length}/${before} order-item rows`,
      phase: "asin_warehouse",
    });
  }

  // Aggregate: (date, asin, ship_city, ship_state) → orders+units+sales.
  // Each report row is one ITEM in one order; multiple items in the same
  // order with the same asin/destination collapse together.
  interface Bucket { asinTitle: string | null; orders: Set<string>; units: number; sales: number }
  const map = new Map<string, Bucket & { date: string; asin: string; shipCity: string; shipState: string }>();
  let rowIdx = 0;
  for (const it of items) {
    rowIdx++;
    if (!it.asin || !it.purchaseDate) continue;
    const k = `${it.purchaseDate}|${it.asin}|${it.shipCity}|${it.shipState}`;
    const cur = map.get(k) ?? {
      date: it.purchaseDate, asin: it.asin,
      shipCity: it.shipCity, shipState: it.shipState,
      asinTitle: it.itemName || null,
      orders: new Set<string>(), units: 0, sales: 0,
    };
    // The All Orders report has no order-id-per-item field we exposed —
    // use the row index as a stand-in so we count each row as a unique "order
    // item line". This double-counts orders when one order ships multiple
    // line items of the same ASIN, but that's rare and acceptable for the
    // warehouse-level view (units count is what most reviewers care about).
    cur.orders.add(`${k}#${rowIdx}`);
    cur.units += it.quantity;
    cur.sales += it.itemPrice * (it.quantity || 1);
    if (!cur.asinTitle && it.itemName) cur.asinTitle = it.itemName;
    map.set(k, cur);
  }

  const rows: AsinWarehouseDailyRow[] = [];
  for (const v of map.values()) {
    rows.push({
      accountId: args.accountId,
      date: v.date, asin: v.asin, asinTitle: v.asinTitle,
      shipCity: v.shipCity, shipState: v.shipState,
      orders: v.orders.size, units: v.units,
      sales: Math.round(v.sales * 100) / 100,
    });
  }
  return upsertAsinWarehouseDaily(rows);
}

async function syncBidRecommendations(args: {
  accountId: string;
  profileId: string;
  targetingMeta: TargetingMetaRow[];
  targetingDaily: TargetingDailyRow[];
  advertisedProductRows: AdvertisedProductDailyRow[];
  errors: RefreshResult["errors"];
}): Promise<number> {
  // 1. Rank ad groups for bid-rec coverage (SP only — bid rec API is SP).
  // First: ad groups with recent SP spend, highest-first. Then: ad groups
  // with keyword targeting meta but no recent spend (paused campaigns,
  // dormant groups) — so even paused-campaign keywords get bid recs cached
  // for when they're re-enabled. All sorted into a single list capped at
  // BID_REC_AD_GROUP_CAP so refresh time stays bounded.
  const spendByAg = new Map<string, number>();
  for (const r of args.targetingDaily) {
    if (r.program !== "SP") continue;
    spendByAg.set(r.adGroupId, (spendByAg.get(r.adGroupId) ?? 0) + r.cost);
  }
  const allSpAgIds = new Set<string>();
  for (const m of args.targetingMeta) {
    if (m.program === "SP" && m.kind === "KEYWORD") allSpAgIds.add(m.adGroupId);
  }
  // Sort: ad-groups with recent spend by spend desc, then everything else
  // (any keyword-bearing SP ad-group) by adGroupId for deterministic order.
  const spending  = [...spendByAg.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const dormant   = [...allSpAgIds].filter((id) => !spendByAg.has(id)).sort();
  const orderedAgs = [...spending, ...dormant].slice(0, BID_REC_AD_GROUP_CAP);
  if (orderedAgs.length === 0) return 0;

  // 2. unique advertised ASINs per ad group (needed by the API).
  const asinsByAg = new Map<string, Set<string>>();
  for (const r of args.advertisedProductRows) {
    if (!r.asin) continue;
    const s = asinsByAg.get(r.adGroupId) ?? new Set<string>();
    s.add(r.asin);
    asinsByAg.set(r.adGroupId, s);
  }

  // 3. group SP keyword targeting meta by ad group.
  //    Include ENABLED + PAUSED keywords — paused keywords still benefit
  //    from a recommendation cache (lets operators see "what would Amazon
  //    suggest if I re-enable this?" without waiting for a refresh cycle).
  //    Skip ARCHIVED keywords — they can't be re-enabled.
  //    PT clauses are excluded: the theme-based bid rec v3 endpoint 422s
  //    on pure-PT ad-groups and silently ignores PT in mixed ones.
  const targetsByAg = new Map<string, TargetingMetaRow[]>();
  for (const m of args.targetingMeta) {
    if (m.program !== "SP") continue;
    if (m.state === "ARCHIVED") continue;
    if (m.kind !== "KEYWORD") continue;
    const arr = targetsByAg.get(m.adGroupId) ?? [];
    arr.push(m);
    targetsByAg.set(m.adGroupId, arr);
  }

  // 4. fetch + collect per ad group, serially (the endpoint is rate-limited
  //    and parallelising it tends to trip Amazon's 425/429 dedup logic).
  const out: BidRecommendationRow[] = [];
  for (const adGroupId of orderedAgs) {
    const targets = targetsByAg.get(adGroupId);
    const asins = [...(asinsByAg.get(adGroupId) ?? [])];
    if (!targets?.length || asins.length === 0) continue;

    const expressions = targets.map((m) => targetingMetaToExpression(m)).filter(Boolean) as { type: string; value?: string }[];
    if (expressions.length === 0) continue;

    try {
      const recs = await getSPBidRecommendations(args.profileId, {
        campaignId: targets[0].campaignId,
        adGroupId,
        asins,
        expressions,
      }, args.accountId);

      const recsByKey = new Map(recs.map((r) => [exprKey(r.expression[0]), r]));
      for (const m of targets) {
        const expr = targetingMetaToExpression(m);
        if (!expr) continue;
        const r = recsByKey.get(exprKey(expr));
        if (!r) continue;
        out.push({
          accountId:  args.accountId,
          targetId:   m.targetId,
          campaignId: m.campaignId,
          adGroupId:  m.adGroupId,
          bidLow:     r.bidLow,
          bidMedian:  r.bidMedian,
          bidHigh:    r.bidHigh,
        });
      }
    } catch (e) {
      args.errors.push({ program: "SP", error: String(e).slice(0, 120), phase: "bid_recs" });
      // continue with next ad group
    }
  }

  return upsertBidRecommendations(out);
}

function targetingMetaToExpression(m: TargetingMetaRow): { type: string; value?: string } | null {
  // Theme-based bid rec v3 only returns useful recs for keywords. The endpoint
  // 422s on pure-PT ad-groups and silently ignores PT clauses in mixed ones,
  // so we never build an expression for product targets.
  if (m.kind === "KEYWORD" && m.display && m.matchType) {
    return { type: `KEYWORD_${m.matchType}_MATCH`, value: m.display };
  }
  return null;
}

function exprKey(e: { type: string; value?: string } | undefined): string {
  return `${e?.type ?? ""}::${e?.value ?? ""}`;
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

// ─── Chunked report fetching ────────────────────────────────────────────────

/** Amazon Reports v3 caps each request at 31 days; we use 30 to leave slack. */
const MAX_REPORT_DAYS = 30;

/** Split [start, end] into <=MAX_REPORT_DAYS day chunks (UTC, inclusive). */
function chunkDateRange(startDate: string, endDate: string): Array<{ s: string; e: string }> {
  const out: Array<{ s: string; e: string }> = [];
  const last = new Date(endDate + "T00:00:00Z");
  let cur = new Date(startDate + "T00:00:00Z");
  while (cur <= last) {
    const chunkEnd = new Date(cur);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + MAX_REPORT_DAYS - 1);
    if (chunkEnd > last) chunkEnd.setTime(last.getTime());
    out.push({ s: cur.toISOString().slice(0, 10), e: chunkEnd.toISOString().slice(0, 10) });
    cur = new Date(chunkEnd);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/**
 * Run `fetcher(s, e)` once per <=30-day chunk of [startDate, endDate], then
 * concatenate using `merge`. Chunks run serially to avoid the Amazon
 * report-creation rate limit. A single-chunk window (≤30 days) is a passthrough.
 */
async function chunkedFetch<T>(
  startDate: string,
  endDate: string,
  fetcher: (s: string, e: string) => Promise<T>,
  merge: (a: T, b: T) => T,
  zero: T,
): Promise<T> {
  const chunks = chunkDateRange(startDate, endDate);
  if (chunks.length === 1) return fetcher(chunks[0].s, chunks[0].e);
  let acc = zero;
  for (const c of chunks) {
    const part = await fetcher(c.s, c.e);
    acc = merge(acc, part);
  }
  return acc;
}
