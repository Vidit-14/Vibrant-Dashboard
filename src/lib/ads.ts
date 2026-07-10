import "server-only";
import { getSheetValues } from "./google";
import { cached } from "./cache";
import { toRecords, num, parseDate, dateKey, findCol, safeAsin } from "./parse";
import { usingSupabase, dbQueryAds, dbQueryTargeting, dbQueryOrders, type AdFilter } from "./db";

export type Country = "IND" | "USA";
export const COUNTRIES: Record<Country, { label: string; currency: string }> = {
  IND: { label: "India", currency: "₹" },
  USA: { label: "USA", currency: "$" },
};

export interface AdRow {
  date: string; // YYYY-MM-DD
  asin: string;
  campaign: string;
  spend: number;
  sales: number;
  orders: number;
  clicks: number;
  impressions: number;
}

export interface TargetingRow extends AdRow {
  targeting: string;
  matchType: string;
}

const TTL = 10 * 60 * 1000;

/**
 * Advertised product report rows, cleaned. Cached 10 min.
 * The filter is pushed down to SQL on Supabase; the Sheets path returns the
 * full cached set (callers filter in JS either way, so both are correct).
 */
export async function loadAds(country: Country, f: AdFilter = {}): Promise<AdRow[]> {
  if (usingSupabase()) return dbQueryAds(country, f);
  return cached(`ads:${country}`, TTL, async () => {
    const recs = toRecords(await getSheetValues(`Advertised_product_${country}`));
    const salesCol = findCol(recs[0], "14 day total sales");
    const rows: AdRow[] = [];
    for (const r of recs) {
      const d = parseDate(r["Date"]);
      if (!d) continue;
      rows.push({
        date: dateKey(d),
        asin: safeAsin(r["Advertised ASIN"]),
        campaign: r["Campaign Name"] ?? "",
        spend: num(r["Spend"]),
        sales: salesCol ? num(r[salesCol]) : 0,
        orders: num(r["14 Day Total Orders (#)"]),
        clicks: num(r["Clicks"]),
        impressions: num(r["Impressions"]),
      });
    }
    return rows;
  });
}

/** Targeting report rows, cleaned. Cached 10 min. Filter pushed down on Supabase. */
export async function loadTargeting(country: Country, f: AdFilter = {}): Promise<TargetingRow[]> {
  if (usingSupabase()) return dbQueryTargeting(country, f);
  return cached(`targeting:${country}`, TTL, async () => {
    const recs = toRecords(await getSheetValues(`Targeting_${country}`));
    const salesCol = findCol(recs[0], "14 day total sales");
    const rows: TargetingRow[] = [];
    for (const r of recs) {
      const d = parseDate(r["Date"]);
      if (!d) continue;
      rows.push({
        date: dateKey(d),
        asin: "",
        campaign: r["Campaign Name"] ?? "",
        targeting: r["Targeting"] ?? "",
        matchType: r["Match Type"] ?? "",
        spend: num(r["Spend"]),
        sales: salesCol ? num(r[salesCol]) : 0,
        orders: num(r["14 Day Total Orders (#)"]),
        clicks: num(r["Clicks"]),
        impressions: num(r["Impressions"]),
      });
    }
    return rows;
  });
}

export interface OrderRow {
  date: string;
  sku: string;
  asin: string;
  units: number;
  sales: number;
}

/** Amazon Orders report (India) — total sales incl. tax/shipping minus promos. */
export async function loadOrdersIND(f: AdFilter = {}): Promise<OrderRow[]> {
  if (usingSupabase()) return dbQueryOrders(f);
  return cached("orders:IND", TTL, async () => {
    const recs = toRecords(await getSheetValues("Orders_IND"));
    const rows: OrderRow[] = [];
    for (const r of recs) {
      const d = parseDate(r["purchase-date"]);
      if (!d) continue;
      const sales =
        num(r["item-price"]) + num(r["item-tax"]) +
        num(r["shipping-price"]) + num(r["shipping-tax"]) +
        num(r["gift-wrap-price"]) + num(r["gift-wrap-tax"]) -
        num(r["item-promotion-discount"]) - num(r["ship-promotion-discount"]);
      rows.push({
        date: dateKey(d),
        sku: r["sku"] ?? "",
        asin: safeAsin(r["asin"]),
        units: num(r["quantity"]),
        sales,
      });
    }
    return rows;
  });
}

export interface Metrics {
  spend: number;
  sales: number;
  orders: number;
  clicks: number;
  impressions: number;
  acos: number;
  roas: number;
  ctr: number;
  cvr: number;
}

export function computeMetrics(t: {
  spend: number; sales: number; orders: number; clicks: number; impressions: number;
}): Metrics {
  return {
    ...t,
    acos: t.sales > 0 ? (t.spend / t.sales) * 100 : 0,
    roas: t.spend > 0 ? t.sales / t.spend : 0,
    ctr: t.impressions > 0 ? (t.clicks / t.impressions) * 100 : 0,
    cvr: t.clicks > 0 ? (t.orders / t.clicks) * 100 : 0,
  };
}

export function sumRows(rows: { spend: number; sales: number; orders: number; clicks: number; impressions: number }[]): Metrics {
  const t = { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 };
  for (const r of rows) {
    t.spend += r.spend;
    t.sales += r.sales;
    t.orders += r.orders;
    t.clicks += r.clicks;
    t.impressions += r.impressions;
  }
  return computeMetrics(t);
}

export function inRange(rows: AdRow[], start: string, end: string): AdRow[];
export function inRange(rows: TargetingRow[], start: string, end: string): TargetingRow[];
export function inRange(rows: AdRow[], start: string, end: string) {
  return rows.filter((r) => r.date >= start && r.date <= end);
}
