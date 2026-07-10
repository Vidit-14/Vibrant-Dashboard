/**
 * Sheet-to-records helpers. Ports the battle-tested Streamlit logic:
 * duplicate/empty header dedupe, ghost blank-row dropping, currency-string
 * numeric coercion, and float-stored ASIN normalisation.
 */

export type Row = Record<string, string>;

/** Convert raw sheet values to records; dedupe headers, drop blank rows. */
export function toRecords(values: string[][]): Row[] {
  if (!values.length) return [];
  const raw = values[0];
  const seen = new Map<string, number>();
  const headers = raw.map((h) => {
    let name = String(h ?? "").trim();
    if (name === "") name = `_empty_${seen.size}`;
    const count = seen.get(name);
    if (count !== undefined) {
      seen.set(name, count + 1);
      return `${name}_${count + 1}`;
    }
    seen.set(name, 0);
    return name;
  });

  const keep = headers.map((h) => !h.startsWith("_empty_"));
  const out: Row[] = [];
  for (let i = 1; i < values.length; i++) {
    const cells = values[i];
    let blank = true;
    const rec: Row = {};
    for (let j = 0; j < headers.length; j++) {
      const v = String(cells?.[j] ?? "").trim();
      if (v !== "") blank = false;
      if (keep[j]) rec[headers[j]] = v;
    }
    if (!blank) out.push(rec);
  }
  return out;
}

/** Coerce a money/number string ("₹1,234.5", "12%", "$9") to a finite number. */
export function num(v: string | number | undefined | null): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (v === undefined || v === null) return 0;
  const cleaned = String(v).replace(/[₹$,%\s]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/** Normalise ASIN values stored as floats ("1636513352.0" → "1636513352"). */
export function safeAsin(v: string | number | undefined | null): string {
  const s = String(v ?? "").trim();
  if (s.endsWith(".0") && /^-?\d+$/.test(s.slice(0, -2))) return s.slice(0, -2);
  return s;
}

/** Parse a date string; returns null when invalid. Handles "Jul 1, 2025", ISO, etc. */
export function parseDate(v: string | undefined | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** YYYY-MM-DD key from a Date (local). */
export function dateKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** YYYY-MM key. */
export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Find a column whose name contains the given substring (case-insensitive). */
export function findCol(rec: Row | undefined, needle: string): string | null {
  if (!rec) return null;
  const lower = needle.toLowerCase();
  for (const k of Object.keys(rec)) {
    if (k.toLowerCase().includes(lower)) return k;
  }
  return null;
}
