import { getSheetValues, overwriteSheet, ensureSheet } from "@/lib/google";
import { invalidate } from "@/lib/cache";
import { toRecords, num, safeAsin } from "@/lib/parse";
import { parseUpload } from "@/lib/upload";
import { HEALTH_SHEET } from "@/lib/health";
import { usingSupabase, dbReplaceHealthMonth } from "@/lib/db";

export async function POST(request: Request) {
  const form = await request.formData();
  const month = form.get("month") as string; // YYYY-MM
  const file = form.get("file") as File | null;
  if (!file || !/^\d{4}-\d{2}$/.test(month ?? "")) {
    return Response.json({ error: "file and month (YYYY-MM) required" }, { status: 400 });
  }

  try {
    const parsed = await parseUpload(file);

    if (usingSupabase()) {
      const rows = parsed.rows
        .map((r) => ({
          asin: safeAsin(String(r["(Child) ASIN"] ?? r["ASIN"] ?? "")),
          title: String(r["Title"] ?? ""),
          sales: num(r["Ordered Product Sales"] as string),
          units: num(r["Units Ordered"] as string),
          sessions: num(r["Sessions - Total"] as string),
          usp: num(r["Unit Session Percentage"] as string),
          buyBox: num(r["Featured Offer Percentage"] as string),
        }))
        .filter((r) => r.asin);
      // one row per ASIN — keep the first occurrence, matching the sheet behavior
      const byAsin = new Map(rows.map((r) => [r.asin, r] as const));
      await dbReplaceHealthMonth(month, [...byAsin.values()]);
      return Response.json({ ok: true, rows: byAsin.size });
    }

    await ensureSheet(HEALTH_SHEET, [...parsed.headers, "Month"]);
    const tagged = parsed.rows.map((r) => ({ ...r, Month: month }));

    const existingValues = await getSheetValues(HEALTH_SHEET);
    const existing = toRecords(existingValues).filter((r) => String(r["Month"]).slice(0, 7) !== month);
    const columns = [...new Set([
      ...(existingValues[0]?.map((h) => String(h).trim()).filter(Boolean) ?? []),
      ...parsed.headers,
      "Month",
    ])];
    const all = [...existing, ...tagged];
    await overwriteSheet(HEALTH_SHEET, columns, all.map((r) => columns.map((c) => (r as Record<string, string | number>)[c] ?? "")));

    invalidate("health:");
    return Response.json({ ok: true, rows: tagged.length });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

// Vercel: allow up to 60s for large sheet/DB reads and file processing
export const maxDuration = 60;
