/**
 * Persistent store for the ASIN × warehouse × day breakdown.
 *
 * Source: SP-API All Orders flat-file report (per-Seller). Populated by the
 * refresh-service when an account has spMarketplaceId configured.
 * Read by /api/asin-warehouse.
 */
import { getDb } from "./index";

export interface AsinWarehouseDailyRow {
  accountId: string;
  date:       string;          // YYYY-MM-DD
  asin:       string;
  asinTitle:  string | null;
  shipCity:   string;
  shipState:  string;
  orders:     number;
  units:      number;
  sales:      number;
}

export function upsertAsinWarehouseDaily(rows: AsinWarehouseDailyRow[]): number {
  if (rows.length === 0) return 0;
  const stmt = getDb().prepare(`
    INSERT INTO asin_warehouse_daily
      (account_id, date, asin, asin_title, ship_city, ship_state, orders, units, sales, updated_at)
    VALUES (@accountId, @date, @asin, @asinTitle, @shipCity, @shipState, @orders, @units, @sales, datetime('now'))
    ON CONFLICT(account_id, date, asin, ship_city, ship_state) DO UPDATE SET
      asin_title = COALESCE(excluded.asin_title, asin_title),
      orders     = excluded.orders,
      units      = excluded.units,
      sales      = excluded.sales,
      updated_at = excluded.updated_at
  `);
  const tx = getDb().transaction((items: typeof rows) => {
    for (const r of items) stmt.run(r);
  });
  tx(rows);
  return rows.length;
}

interface RawRow {
  date: string; asin: string; asin_title: string | null;
  ship_city: string; ship_state: string;
  orders: number; units: number; sales: number;
}

export function readAsinWarehouseDaily(
  accountId: string,
  startDate: string,
  endDate: string,
): AsinWarehouseDailyRow[] {
  return (getDb()
    .prepare(`
      SELECT date, asin, asin_title, ship_city, ship_state, orders, units, sales
      FROM asin_warehouse_daily
      WHERE account_id = ? AND date BETWEEN ? AND ?
    `)
    .all(accountId, startDate, endDate) as RawRow[])
    .map((r) => ({
      accountId,
      date: r.date, asin: r.asin, asinTitle: r.asin_title,
      shipCity: r.ship_city, shipState: r.ship_state,
      orders: r.orders, units: r.units, sales: r.sales,
    }));
}

export function asinWarehouseCoverage(accountId: string): { min: string | null; max: string | null; rowCount: number } {
  const r = getDb()
    .prepare("SELECT MIN(date) AS min, MAX(date) AS max, COUNT(*) AS n FROM asin_warehouse_daily WHERE account_id = ?")
    .get(accountId) as { min: string | null; max: string | null; n: number };
  return { min: r.min, max: r.max, rowCount: r.n };
}
