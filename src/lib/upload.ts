import "server-only";
import * as XLSX from "xlsx";

export interface ParsedFile {
  headers: string[];
  rows: Record<string, string | number>[];
}

/** Parse an uploaded xlsx/csv/txt File into records. Dates come back as formatted strings. */
export async function parseUpload(file: File): Promise<ParsedFile> {
  const buf = Buffer.from(await file.arrayBuffer());
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true, raw: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, string | number>>(ws, {
    defval: "",
    raw: false,
  });
  const headers = rows.length ? Object.keys(rows[0]) : [];
  // sanitize: no NaN/inf ever goes to Sheets
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      const v = r[k];
      if (typeof v === "number" && !Number.isFinite(v)) r[k] = "";
    }
  }
  return { headers, rows };
}

/** Format a Date-like value the way the ad sheets store it: "Jul 1, 2025". */
export function adsDateString(v: string): string {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Records → array-of-arrays in the given column order (blank for missing). */
export function toMatrix(rows: Record<string, string | number>[], columns: string[]): (string | number)[][] {
  return rows.map((r) => columns.map((c) => r[c] ?? ""));
}
