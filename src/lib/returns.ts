import "server-only";
import { getSheetValues, overwriteSheet, ensureSheet } from "./google";
import { cached, invalidate } from "./cache";
import { toRecords, parseDate, dateKey, safeAsin, type Row } from "./parse";
import { usingSupabase, dbLoadCombinedReturns } from "./db";

const RETURNS_SHEET = "FBA-Returns-Data";
const SALES_SHEET = "Fulfilled-Sales-Data";
const COMBINED_SHEET = "Returns-Sales-Comb-Data";

export const RETURNS_COLS = ["Order Id", "ASIN", "detailed-disposition", "reason", "customer-comments", "return-date", "Date"];
export const SALES_COLS = ["Order Id", "Date", "Buyer Email", "Title", "Shipping Postal Code"];

export interface CombinedRow {
  date: string;
  orderId: string;
  asin: string;
  disposition: string;
  reason: string;
  comments: string;
  buyerEmail: string;
  title: string;
  pincode: string;
}

async function loadRaw(sheet: string): Promise<Row[]> {
  await ensureSheet(sheet, sheet === RETURNS_SHEET ? RETURNS_COLS : SALES_COLS);
  return toRecords(await getSheetValues(sheet));
}

/** Join returns (left) with fulfilled sales on Order Id. */
export async function loadCombined(): Promise<CombinedRow[]> {
  if (usingSupabase()) return dbLoadCombinedReturns();
  return cached("returns:combined", 5 * 60 * 1000, async () => {
    const [returns, sales] = await Promise.all([loadRaw(RETURNS_SHEET), loadRaw(SALES_SHEET)]);
    const salesByOrder = new Map<string, Row>();
    for (const s of sales) {
      const id = String(s["Order Id"] ?? "").trim();
      if (id) salesByOrder.set(id, s);
    }
    const out: CombinedRow[] = [];
    for (const r of returns) {
      const d = parseDate(r["Date"]) ?? parseDate(r["return-date"]);
      if (!d) continue;
      const orderId = String(r["Order Id"] ?? "").trim();
      const s = salesByOrder.get(orderId);
      out.push({
        date: dateKey(d),
        orderId,
        asin: safeAsin(r["ASIN"]),
        disposition: r["detailed-disposition"] ?? "",
        reason: r["reason"] ?? "",
        comments: r["customer-comments"] ?? "",
        buyerEmail: s?.["Buyer Email"] ?? "",
        title: s?.["Title"] ?? "",
        pincode: String(s?.["Shipping Postal Code"] ?? "").split(".")[0],
      });
    }
    return out.sort((a, b) => b.date.localeCompare(a.date));
  });
}

/** Append + dedupe a raw sheet on a unique key column (keep last), like update_raw_sheet. */
export async function updateRawSheet(
  sheet: string,
  columns: string[],
  newRows: Record<string, string | number>[],
  uniqueCol: string,
) {
  const existing = toRecords(await getSheetValues(sheet));
  const byKey = new Map<string, Record<string, string | number>>();
  for (const r of existing) byKey.set(String(r[uniqueCol] ?? ""), r);
  for (const r of newRows) byKey.set(String(r[uniqueCol] ?? ""), r);
  byKey.delete("");
  const rows = [...byKey.values()].map((r) => columns.map((c) => r[c] ?? ""));
  await overwriteSheet(sheet, columns, rows);
}

/** Regenerate & persist the combined sheet (kept for parity with the Streamlit app). */
export async function regenerateCombined() {
  invalidate("returns:combined");
  const combined = await loadCombined();
  const header = ["Date", "Order Id", "ASIN", "detailed-disposition", "reason", "customer-comments", "Buyer Email", "Title", "Shipping Postal Code"];
  await ensureSheet(COMBINED_SHEET, header);
  await overwriteSheet(
    COMBINED_SHEET,
    header,
    combined.map((r) => [r.date, r.orderId, r.asin, r.disposition, r.reason, r.comments, r.buyerEmail, r.title, r.pincode]),
  );
}

export { RETURNS_SHEET, SALES_SHEET };
