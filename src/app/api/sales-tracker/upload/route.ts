import { getSheetValues, overwriteSheet, ensureSheet } from "@/lib/google";
import { invalidate } from "@/lib/cache";
import { toRecords, num, safeAsin } from "@/lib/parse";
import { parseUpload } from "@/lib/upload";
import { usingSupabase, dbReplaceMonthly, dbReplaceDaily } from "@/lib/db";

/** Replace all rows matching `matchValue` in `matchCol`, then append the new block. */
async function replaceBlock(
  sheet: string,
  matchCol: string,
  matchValue: string,
  newRows: Record<string, string | number>[],
) {
  const existingValues = await getSheetValues(sheet);
  const existing = toRecords(existingValues);
  const kept = existing.filter((r) => String(r[matchCol]).slice(0, matchValue.length) !== matchValue);
  const columns = [...new Set([
    ...(existingValues[0]?.map((h) => String(h).trim()).filter(Boolean) ?? []),
    ...(newRows[0] ? Object.keys(newRows[0]) : []),
  ])];
  const all = [...kept, ...newRows];
  await overwriteSheet(sheet, columns, all.map((r) => columns.map((c) => (r as Record<string, string | number>)[c] ?? "")));
}

export async function POST(request: Request) {
  const form = await request.formData();
  const kind = form.get("kind") as string; // "monthly" | "daily"
  const file = form.get("file") as File | null;
  if (!file || !["monthly", "daily"].includes(kind)) {
    return Response.json({ error: "file and kind (monthly|daily) required" }, { status: 400 });
  }

  try {
    const parsed = await parseUpload(file);
    // one normalized row per ASIN (report rows can repeat an ASIN)
    const normalized = new Map<string, { asin: string; title: string; units: number }>();
    for (const r of parsed.rows) {
      const asin = safeAsin(String(r["(Child) ASIN"] ?? r["ASIN"] ?? ""));
      if (!asin) continue;
      const e = normalized.get(asin) ?? { asin, title: String(r["Title"] ?? ""), units: 0 };
      e.units += num(r["Units Ordered"] as string);
      normalized.set(asin, e);
    }
    const normRows = [...normalized.values()];

    if (kind === "monthly") {
      const month = form.get("month") as string; // YYYY-MM
      if (!/^\d{4}-\d{2}$/.test(month ?? "")) return Response.json({ error: "month (YYYY-MM) required" }, { status: 400 });

      if (usingSupabase()) {
        const [y2, m2] = month.split("-").map(Number);
        const dim = new Date(y2, m2, 0).getDate();
        const top = [...normRows]
          .sort((a, b) => b.units - a.units)
          .slice(0, 30)
          .map((r) => ({ asin: r.asin, title: r.title, avg: +(r.units / dim).toFixed(4) }));
        await dbReplaceMonthly(month, normRows, top);
        return Response.json({ ok: true, rows: normRows.length, top: top.length });
      }

      await ensureSheet("Business_Reports_Monthly", [...parsed.headers, "Month"]);
      const tagged: Record<string, string | number>[] = parsed.rows.map((r) => ({ ...r, Month: month }));
      await replaceBlock("Business_Reports_Monthly", "Month", month, tagged);

      // top-30 ASINs by units → average daily units baseline
      const [y, m] = month.split("-").map(Number);
      const daysInMonth = new Date(y, m, 0).getDate();
      const top30 = tagged
        .map((r) => ({
          Month: month,
          ASIN: String(r["(Child) ASIN"] ?? r["ASIN"] ?? ""),
          Title: String(r["Title"] ?? ""),
          units: num(r["Units Ordered"] as string),
        }))
        .sort((a, b) => b.units - a.units)
        .slice(0, 30)
        .map((r) => ({
          Month: r.Month,
          ASIN: r.ASIN,
          Title: r.Title,
          "Avg Daily Units": +(r.units / daysInMonth).toFixed(4),
        }));

      await ensureSheet("Top_ASINs_Monthly_Avg", ["Month", "ASIN", "Title", "Avg Daily Units"]);
      await replaceBlock("Top_ASINs_Monthly_Avg", "Month", month, top30);
      invalidate("tracker:");
      return Response.json({ ok: true, rows: tagged.length, top: top30.length });
    }

    // daily
    const date = form.get("date") as string; // YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) return Response.json({ error: "date (YYYY-MM-DD) required" }, { status: 400 });

    if (usingSupabase()) {
      await dbReplaceDaily(date, normRows);
      return Response.json({ ok: true, rows: normRows.length });
    }

    await ensureSheet("Business_Reports_Daily", [...parsed.headers, "Date"]);
    const tagged = parsed.rows.map((r) => ({ ...r, Date: date }));
    await replaceBlock("Business_Reports_Daily", "Date", date, tagged);
    invalidate("tracker:");
    return Response.json({ ok: true, rows: tagged.length });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

// Vercel: allow up to 60s for large sheet/DB reads and file processing
export const maxDuration = 60;
