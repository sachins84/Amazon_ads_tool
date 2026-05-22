import { type NextRequest } from "next/server";
import { spRequest, SpApiError } from "@/lib/sp-api/client";

export const dynamic = "force-dynamic";

/**
 * GET /api/sp-fee-types-probe?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&sku=optional
 *
 * Returns aggregated abs(amount) per FeeType / ChargeType across shipment +
 * refund events, plus a count of events seen. If sku is passed, filters to
 * only items with that SellerSKU so we can see what fees a known SKU incurs.
 */
interface MoneyAmount { CurrencyAmount: number; CurrencyCode: string }
interface ChargeOrFee { ChargeType?: string; FeeType?: string; ChargeAmount?: MoneyAmount; FeeAmount?: MoneyAmount }
interface ShipmentItem {
  SellerSKU?: string;
  ItemChargeList?: ChargeOrFee[];
  ItemFeeList?: ChargeOrFee[];
}
interface ShipmentEvent { ShipmentItemList?: ShipmentItem[] }
interface FinancialEventsResponse {
  payload: {
    FinancialEvents: {
      ShipmentEventList?: ShipmentEvent[];
      RefundEventList?: ShipmentEvent[];
      AdjustmentEventList?: unknown[];
      ServiceFeeEventList?: unknown[];
    };
    NextToken?: string;
  };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const startDate = sp.get("startDate");
  const endDate   = sp.get("endDate");
  const skuFilter = sp.get("sku");
  if (!startDate || !endDate) return Response.json({ error: "startDate + endDate required" }, { status: 400 });

  const todayUtc = new Date().toISOString().split("T")[0];
  const postedBefore = endDate >= todayUtc
    ? new Date(Date.now() - 3 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z")
    : `${endDate}T23:59:59Z`;

  const feeTypeFromShipments: Record<string, { count: number; total: number }> = {};
  const chargeTypeFromShipments: Record<string, { count: number; total: number }> = {};
  const feeTypeFromRefunds: Record<string, { count: number; total: number }> = {};
  const otherEventCounts: Record<string, number> = {};

  let pages = 0;
  let nextToken: string | undefined;
  try {
    do {
      const params: Record<string, string> = {
        PostedAfter:       `${startDate}T00:00:00Z`,
        PostedBefore:      postedBefore,
        MaxResultsPerPage: "100",
      };
      if (nextToken) params.NextToken = nextToken;

      let attempt = 0;
      let res: FinancialEventsResponse | null = null;
      while (attempt < 5) {
        try {
          res = await spRequest<FinancialEventsResponse>("/finances/v0/financialEvents", { params });
          break;
        } catch (e) {
          if (e instanceof SpApiError && e.status === 429 && attempt < 4) {
            await new Promise((r) => setTimeout(r, 2500 * Math.pow(2, attempt)));
            attempt++; continue;
          }
          throw e;
        }
      }
      if (!res) throw new Error("rate limit retries exhausted");

      const fe = res.payload.FinancialEvents;
      for (const e of fe.ShipmentEventList ?? []) {
        for (const it of e.ShipmentItemList ?? []) {
          if (skuFilter && it.SellerSKU !== skuFilter) continue;
          for (const f of it.ItemFeeList ?? []) {
            const k = f.FeeType ?? "(none)";
            const amt = Math.abs(f.FeeAmount?.CurrencyAmount ?? 0);
            feeTypeFromShipments[k] ??= { count: 0, total: 0 };
            feeTypeFromShipments[k].count++;
            feeTypeFromShipments[k].total += amt;
          }
          for (const c of it.ItemChargeList ?? []) {
            const k = c.ChargeType ?? "(none)";
            const amt = Math.abs(c.ChargeAmount?.CurrencyAmount ?? 0);
            chargeTypeFromShipments[k] ??= { count: 0, total: 0 };
            chargeTypeFromShipments[k].count++;
            chargeTypeFromShipments[k].total += amt;
          }
        }
      }
      for (const e of fe.RefundEventList ?? []) {
        for (const it of e.ShipmentItemList ?? []) {
          if (skuFilter && it.SellerSKU !== skuFilter) continue;
          for (const f of it.ItemFeeList ?? []) {
            const k = f.FeeType ?? "(none)";
            const amt = Math.abs(f.FeeAmount?.CurrencyAmount ?? 0);
            feeTypeFromRefunds[k] ??= { count: 0, total: 0 };
            feeTypeFromRefunds[k].count++;
            feeTypeFromRefunds[k].total += amt;
          }
        }
      }
      // Note presence of other event types — these may carry commission too
      for (const k of ["AdjustmentEventList","ServiceFeeEventList","DebtRecoveryEventList","ChargebackEventList","ProductAdsPaymentEventList"] as const) {
        const arr = (fe as Record<string, unknown[] | undefined>)[k];
        if (arr?.length) otherEventCounts[k] = (otherEventCounts[k] ?? 0) + arr.length;
      }

      nextToken = res.payload.NextToken;
      pages++;
      if (nextToken) await new Promise((r) => setTimeout(r, 2100));
    } while (nextToken && pages < 50);

    return Response.json({
      window: { startDate, endDate },
      pages,
      skuFilter: skuFilter ?? null,
      feeTypeFromShipments,
      chargeTypeFromShipments,
      feeTypeFromRefunds,
      otherEventCounts,
    });
  } catch (e) {
    return Response.json({ error: String(e), pages }, { status: 200 });
  }
}
