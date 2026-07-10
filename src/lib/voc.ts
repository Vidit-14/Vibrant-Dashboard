import "server-only";
import { getSheetValues, overwriteSheet, ensureSheet } from "./google";
import { cached, invalidate } from "./cache";
import { toRecords, parseDate, dateKey } from "./parse";
import { usingSupabase, dbLoadVoc, dbSaveVocSnapshot } from "./db";

export const VOC_SHEET = "VOC_Status_Snapshots";
export const VOC_COLS = [
  "Snapshot Date", "Product name", "ASIN", "SKU", "Condition", "Fulfilled by",
  "NCX rate", "NCX orders", "Total orders", "Star rating", "Return rate",
  "Top NCX reason", "Last updated", "Status", "Return Badge Displayed",
];
export const STATUS_ORDER = ["Very poor", "Poor", "Fair", "Good", "Excellent"];

export function cleanStatus(x: string): string {
  let s = String(x).replace(/ /g, " ").replace(/[-_]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  if (s === "very poor") return "Very poor";
  if (s === "poor") return "Poor";
  if (s === "fair") return "Fair";
  if (s === "good") return "Good";
  if (s === "excellent") return "Excellent";
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function cleanAsin(x: string | number): string {
  return String(x).trim().toUpperCase();
}

export interface VocRow {
  snapshotDate: string;
  productName: string;
  asin: string;
  sku: string;
  ncxRate: string;
  ncxOrders: string;
  totalOrders: string;
  starRating: string;
  returnRate: string;
  topReason: string;
  status: string;
}

/** All snapshots, one row per (date, ASIN), keeping the worst status on duplicates. */
export async function loadSnapshots(): Promise<VocRow[]> {
  if (usingSupabase()) return dbLoadVoc();
  await ensureSheet(VOC_SHEET, VOC_COLS);
  return cached("voc", 5 * 60 * 1000, async () => {
    const recs = toRecords(await getSheetValues(VOC_SHEET));
    const rank = new Map(STATUS_ORDER.map((s, i) => [s, i])); // 0 = worst
    const byKey = new Map<string, VocRow>();
    for (const r of recs) {
      const d = parseDate(r["Snapshot Date"]);
      if (!d) continue;
      const row: VocRow = {
        snapshotDate: dateKey(d),
        productName: r["Product name"] ?? "",
        asin: cleanAsin(r["ASIN"] ?? ""),
        sku: r["SKU"] ?? "",
        ncxRate: r["NCX rate"] ?? "",
        ncxOrders: r["NCX orders"] ?? "",
        totalOrders: r["Total orders"] ?? "",
        starRating: r["Star rating"] ?? "",
        returnRate: r["Return rate"] ?? "",
        topReason: r["Top NCX reason"] ?? "",
        status: cleanStatus(r["Status"] ?? ""),
      };
      const key = `${row.snapshotDate}||${row.asin}`;
      const prev = byKey.get(key);
      if (!prev || (rank.get(row.status) ?? 999) < (rank.get(prev.status) ?? 999)) {
        byKey.set(key, row);
      }
    }
    return [...byKey.values()];
  });
}

/** Save a snapshot: replace rows for the same (date, ASIN), append the rest. */
export async function saveSnapshot(rows: Record<string, string | number>[], snapshotDate: string) {
  if (usingSupabase()) {
    return dbSaveVocSnapshot(
      snapshotDate,
      rows.map((r) => ({
        asin: cleanAsin(String(r["ASIN"] ?? "")),
        productName: String(r["Product name"] ?? ""),
        sku: String(r["SKU"] ?? ""),
        ncxRate: String(r["NCX rate"] ?? ""),
        ncxOrders: String(r["NCX orders"] ?? ""),
        totalOrders: String(r["Total orders"] ?? ""),
        starRating: String(r["Star rating"] ?? ""),
        returnRate: String(r["Return rate"] ?? ""),
        topReason: String(r["Top NCX reason"] ?? ""),
        status: cleanStatus(String(r["Status"] ?? "")),
      })),
    );
  }
  const existing = toRecords(await getSheetValues(VOC_SHEET));
  const incomingKeys = new Set(rows.map((r) => `${snapshotDate}||${cleanAsin(String(r["ASIN"] ?? ""))}`));
  const kept = existing.filter((r) => {
    const d = parseDate(r["Snapshot Date"]);
    const key = `${d ? dateKey(d) : ""}||${cleanAsin(r["ASIN"] ?? "")}`;
    return !incomingKeys.has(key);
  });
  const all = [
    ...kept,
    ...rows.map((r) => ({ ...r, "Snapshot Date": snapshotDate })),
  ];
  await overwriteSheet(VOC_SHEET, VOC_COLS, all.map((r) => VOC_COLS.map((c) => (r as Record<string, string | number>)[c] ?? "")));
  invalidate("voc");
}
