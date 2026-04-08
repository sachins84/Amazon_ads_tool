/**
 * SP-API Orders API — fetch total sales (all orders, not just ad-attributed).
 * Used for TACoS and organic revenue calculations.
 *
 * Docs: https://developer-docs.amazon.com/sp-api/docs/orders-api-v0-reference
 */
import { spRequest } from "./client";

export interface Order {
  AmazonOrderId: string;
  PurchaseDate: string;
  OrderStatus: string;
  OrderTotal?: { Amount: string; CurrencyCode: string };
  NumberOfItemsShipped: number;
  NumberOfItemsUnshipped: number;
}

interface OrdersResponse {
  payload: {
    Orders: Order[];
    NextToken?: string;
  };
}

export interface DailySalesSummary {
  date: string;          // YYYY-MM-DD
  totalRevenue: number;
  totalOrders: number;
  totalUnits: number;
}

/**
 * Fetch all orders in a date range and aggregate into daily revenue buckets.
 * Automatically paginates through NextToken.
 */
export async function fetchDailySales(
  marketplaceId: string,
  startDate: string,
  endDate: string
): Promise<DailySalesSummary[]> {
  const allOrders: Order[] = [];
  let nextToken: string | undefined;

  do {
    const params: Record<string, string> = {
      MarketplaceIds:          marketplaceId,
      CreatedAfter:            `${startDate}T00:00:00Z`,
      CreatedBefore:           `${endDate}T23:59:59Z`,
      OrderStatuses:           "Shipped,Unshipped,PartiallyShipped",
      MaxResultsPerPage:       "100",
    };
    if (nextToken) params.NextToken = nextToken;

    const res = await spRequest<OrdersResponse>("/orders/v0/orders", { params });
    allOrders.push(...res.payload.Orders);
    nextToken = res.payload.NextToken;
  } while (nextToken);

  // Aggregate by date
  const map = new Map<string, DailySalesSummary>();

  for (const order of allOrders) {
    if (!order.OrderTotal) continue;
    const date = order.PurchaseDate.split("T")[0];
    const revenue = parseFloat(order.OrderTotal.Amount) || 0;
    const units = (order.NumberOfItemsShipped ?? 0) + (order.NumberOfItemsUnshipped ?? 0);

    const existing = map.get(date) ?? { date, totalRevenue: 0, totalOrders: 0, totalUnits: 0 };
    map.set(date, {
      ...existing,
      totalRevenue: Math.round((existing.totalRevenue + revenue) * 100) / 100,
      totalOrders:  existing.totalOrders + 1,
      totalUnits:   existing.totalUnits + units,
    });
  }

  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Summary totals across the full date range (for KPI cards).
 */
export async function fetchSalesSummary(
  marketplaceId: string,
  startDate: string,
  endDate: string
): Promise<{ totalRevenue: number; totalOrders: number; totalUnits: number }> {
  const daily = await fetchDailySales(marketplaceId, startDate, endDate);
  return daily.reduce(
    (acc, d) => ({
      totalRevenue: Math.round((acc.totalRevenue + d.totalRevenue) * 100) / 100,
      totalOrders:  acc.totalOrders + d.totalOrders,
      totalUnits:   acc.totalUnits + d.totalUnits,
    }),
    { totalRevenue: 0, totalOrders: 0, totalUnits: 0 }
  );
}
