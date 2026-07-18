/**
 * Client-safe helpers for the ads report upload. The raw xlsx files can exceed
 * Vercel's ~4.5 MB request-body limit, so the browser parses them locally and
 * streams compact typed rows to the API in chunks (see dashboard UploadDialog).
 * Shared with the server route so both paths normalize identically.
 */
import { parseDate, num, dateKey, safeAsin, findCol } from "./parse";
import type { AdRow, TargetingRow, OrderRow } from "./ads";

export type UploadRecords = Record<string, string | number>[];

/** Rows per JSON chunk — keeps each request well under Vercel's body limit. */
export const UPLOAD_CHUNK = 6000;

/** Browser-side twin of lib/upload's parseUpload (xlsx is dynamically imported). */
export async function parseReportFile(file: File): Promise<UploadRecords> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true, raw: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, string | number>>(ws, { defval: "", raw: false });
  // sanitize: no NaN/inf ever leaves the parser
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      const v = r[k];
      if (typeof v === "number" && !Number.isFinite(v)) r[k] = "";
    }
  }
  return rows;
}

/* Normalizers: uploaded report records → clean typed rows (same rules as the loaders). */

export function toAdRows(rows: UploadRecords): AdRow[] {
  const salesCol = findCol(rows[0] as Record<string, string>, "14 day total sales");
  const out: AdRow[] = [];
  for (const r of rows) {
    const d = parseDate(String(r["Date"] ?? ""));
    if (!d) continue;
    out.push({
      date: dateKey(d),
      asin: safeAsin(String(r["Advertised ASIN"] ?? "")),
      campaign: String(r["Campaign Name"] ?? ""),
      spend: num(r["Spend"] as string),
      sales: salesCol ? num(r[salesCol] as string) : 0,
      orders: num(r["14 Day Total Orders (#)"] as string),
      clicks: num(r["Clicks"] as string),
      impressions: num(r["Impressions"] as string),
    });
  }
  return out;
}

export function toTargetingRows(rows: UploadRecords): TargetingRow[] {
  const salesCol = findCol(rows[0] as Record<string, string>, "14 day total sales");
  const out: TargetingRow[] = [];
  for (const r of rows) {
    const d = parseDate(String(r["Date"] ?? ""));
    if (!d) continue;
    out.push({
      date: dateKey(d),
      asin: "",
      campaign: String(r["Campaign Name"] ?? ""),
      targeting: String(r["Targeting"] ?? ""),
      matchType: String(r["Match Type"] ?? ""),
      spend: num(r["Spend"] as string),
      sales: salesCol ? num(r[salesCol] as string) : 0,
      orders: num(r["14 Day Total Orders (#)"] as string),
      clicks: num(r["Clicks"] as string),
      impressions: num(r["Impressions"] as string),
    });
  }
  return out;
}

export function toOrderRows(rows: UploadRecords): OrderRow[] {
  const out: OrderRow[] = [];
  for (const r of rows) {
    const d = parseDate(String(r["purchase-date"] ?? ""));
    if (!d) continue;
    const s = (k: string) => r[k] as string;
    out.push({
      date: dateKey(d),
      sku: String(r["sku"] ?? ""),
      asin: safeAsin(String(r["asin"] ?? "")),
      units: num(s("quantity")),
      sales:
        num(s("item-price")) + num(s("item-tax")) +
        num(s("shipping-price")) + num(s("shipping-tax")) +
        num(s("gift-wrap-price")) + num(s("gift-wrap-tax")) -
        num(s("item-promotion-discount")) - num(s("ship-promotion-discount")),
    });
  }
  return out;
}
