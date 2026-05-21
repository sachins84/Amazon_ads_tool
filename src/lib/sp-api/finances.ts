/**
 * SP-API Finances — pulls /finances/v0/financialEvents for a window and
 * aggregates Amazon-side commission + fulfillment/shipping fees.
 *
 * Used by /api/pnl to replace the configured-factor approximation of
 * "commission" and "logistics" with actual fee totals from settlements.
 * Pro-rated per brand by revenue share downstream — we don't have a
 * clean SKU → brand mapping for fee events, so this returns marketplace-
 * wide totals and the caller splits them.
 *
 * Docs: https://developer-docs.amazon.com/sp-api/docs/finances-api-v0-reference
 */
import { spRequest } from "./client";
import { withCache } from "@/lib/cache";

interface MoneyAmount { CurrencyAmount: number; CurrencyCode: string }
interface ChargeOrFee { ChargeType?: string; FeeType?: string; ChargeAmount?: MoneyAmount; FeeAmount?: MoneyAmount }
interface ShipmentItem {
  SellerSKU?: string;
  ItemChargeList?: ChargeOrFee[];
  ItemFeeList?: ChargeOrFee[];
}
interface ShipmentEvent {
  AmazonOrderId?: string;
  PostedDate?: string;
  ShipmentItemList?: ShipmentItem[];
}
interface FinancialEventsResponse {
  payload: {
    FinancialEvents: {
      ShipmentEventList?: ShipmentEvent[];
      RefundEventList?: ShipmentEvent[];
    };
    NextToken?: string;
  };
}

export interface PerSkuFees {
  sku: string;
  commission: number;   // |sum| of Commission fees
  fulfillment: number;  // |sum| of FBA fulfillment + closing fees
  storage: number;      // |sum| of storage fees
  refunds: number;      // |sum| of refund fees on this SKU
}

export interface SellerFeeAggregates {
  // Per-SKU breakdown — attributed to each SellerSKU from ShipmentItem rows.
  bySku: Map<string, PerSkuFees>;
  // Marketplace-wide rollups (sum of all per-SKU values + any uncategorised).
  commission: number;
  fulfillment: number;
  storage: number;
  refunds: number;
  totalEvents: number;
}

const FULFILLMENT_FEES = new Set([
  "FBAPerUnitFulfillmentFee",
  "FBAWeightBasedFee",
  "FBAPickAndPackFee",
  "ShippingChargeback",
  "ShippingHB",
  "VariableClosingFee",
  "FixedClosingFee",
]);
const STORAGE_FEES = new Set([
  "FBAStorageFee",
  "FBALongTermStorageFee",
  "FBAInventoryPlacementServiceFee",
  "Subscription",
]);

function absAmount(x?: MoneyAmount): number {
  return x ? Math.abs(x.CurrencyAmount ?? 0) : 0;
}

function newSkuRow(sku: string): PerSkuFees {
  return { sku, commission: 0, fulfillment: 0, storage: 0, refunds: 0 };
}

/** Walk shipment + refund events; attribute each fee to its SellerSKU. */
function tallyEvents(
  payload: FinancialEventsResponse["payload"]["FinancialEvents"],
  bySku: Map<string, PerSkuFees>,
  totals: { commission: number; fulfillment: number; storage: number; refunds: number; totalEvents: number },
): void {
  const walkItems = (items: ShipmentItem[] | undefined, isRefund: boolean) => {
    for (const it of items ?? []) {
      const sku = it.SellerSKU || "(unknown_sku)";
      const row = bySku.get(sku) ?? newSkuRow(sku);
      // ItemFeeList = Amazon fees; ItemChargeList = price components.
      // Commission usually appears in ItemFeeList — accept both.
      const candidates = [...(it.ItemFeeList ?? []), ...(it.ItemChargeList ?? [])];
      for (const c of candidates) {
        const type = c.FeeType ?? c.ChargeType ?? "";
        const amt  = absAmount(c.FeeAmount ?? c.ChargeAmount);
        if (!amt) continue;
        if (isRefund) { row.refunds += amt; totals.refunds += amt; continue; }
        if (type === "Commission") {
          row.commission += amt; totals.commission += amt;
        } else if (FULFILLMENT_FEES.has(type)) {
          row.fulfillment += amt; totals.fulfillment += amt;
        } else if (STORAGE_FEES.has(type)) {
          row.storage += amt; totals.storage += amt;
        }
      }
      bySku.set(sku, row);
    }
  };

  for (const e of payload.ShipmentEventList ?? []) { walkItems(e.ShipmentItemList, false); totals.totalEvents++; }
  for (const e of payload.RefundEventList   ?? []) { walkItems(e.ShipmentItemList, true ); totals.totalEvents++; }
}

/** Page through /finances/v0/financialEvents and build a per-SKU map. */
async function pageFinancialEvents(startDate: string, endDate: string): Promise<SellerFeeAggregates> {
  const bySku = new Map<string, PerSkuFees>();
  const totals = { commission: 0, fulfillment: 0, storage: 0, refunds: 0, totalEvents: 0 };
  let nextToken: string | undefined;
  let pages = 0;
  const MAX_PAGES = 50;       // safety net — 100 events/page × 50 = 5000 events

  // SP-API requires PostedBefore to be no later than ~2 min ago. If endDate
  // is today, cap the upper bound at now - 3 min instead of 23:59:59Z.
  const todayUtc = new Date().toISOString().split("T")[0];
  const postedBefore = endDate >= todayUtc
    ? new Date(Date.now() - 3 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z")
    : `${endDate}T23:59:59Z`;

  do {
    const params: Record<string, string> = {
      PostedAfter:       `${startDate}T00:00:00Z`,
      PostedBefore:      postedBefore,
      MaxResultsPerPage: "100",
    };
    if (nextToken) params.NextToken = nextToken;
    const res = await spRequest<FinancialEventsResponse>("/finances/v0/financialEvents", { params });
    tallyEvents(res.payload.FinancialEvents, bySku, totals);
    nextToken = res.payload.NextToken;
    pages++;
  } while (nextToken && pages < MAX_PAGES);
  return { bySku, ...totals };
}

/** Cached + de-duped marketplace-wide fee aggregates. 10-min TTL; key is
 *  startDate+endDate (marketplace is implicit in the auth). */
const inflight = new Map<string, Promise<SellerFeeAggregates>>();
export async function fetchSellerFeeAggregates(startDate: string, endDate: string): Promise<SellerFeeAggregates> {
  const key = `seller-fees:${startDate}:${endDate}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = withCache(key, () => pageFinancialEvents(startDate, endDate), 10 * 60 * 1000)
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
