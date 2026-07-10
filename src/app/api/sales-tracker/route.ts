import { getSheetValues, ensureSheet } from "@/lib/google";
import { cached } from "@/lib/cache";
import { toRecords, num, safeAsin } from "@/lib/parse";
import { usingSupabase, dbTrackerBaseline, dbTrackerDaily } from "@/lib/db";

/**
 * GET ?month=YYYY-MM
 * Baseline = previous month's Top_ASINs_Monthly_Avg; daily units pivot from
 * Business_Reports_Daily for the selected month.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const month = url.searchParams.get("month"); // YYYY-MM
  if (!month) return Response.json({ error: "month required" }, { status: 400 });

  try {
    const [y, m] = month.split("-").map(Number);
    const prev = new Date(y, m - 2, 1);
    const prevKey = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;

    let baseline: { asin: string; title: string; avg: number }[];
    let dates: string[];
    const unitsBy = new Map<string, number>(); // asin||date -> units

    if (usingSupabase()) {
      const [base, daily] = await Promise.all([dbTrackerBaseline(prevKey), dbTrackerDaily(month)]);
      baseline = base;
      dates = [...new Set(daily.map((r) => r.date))].sort();
      for (const r of daily) {
        const key = `${r.asin}||${r.date}`;
        unitsBy.set(key, (unitsBy.get(key) ?? 0) + r.units);
      }
    } else {
      await ensureSheet("Top_ASINs_Monthly_Avg", ["Month", "ASIN", "Title", "Avg Daily Units"]);
      await ensureSheet("Business_Reports_Daily", ["Date"]);

      const [avgAll, dailyAll] = await Promise.all([
        cached("tracker:avg", 5 * 60 * 1000, async () => toRecords(await getSheetValues("Top_ASINs_Monthly_Avg"))),
        cached("tracker:daily", 5 * 60 * 1000, async () => toRecords(await getSheetValues("Business_Reports_Daily"))),
      ]);

      baseline = avgAll
        .filter((r) => String(r["Month"]).slice(0, 7) === prevKey)
        .map((r) => ({ asin: safeAsin(r["ASIN"]), title: r["Title"] ?? "", avg: num(r["Avg Daily Units"]) }));

      const daily = dailyAll.filter((r) => String(r["Date"]).slice(0, 7) === month);
      dates = [...new Set(daily.map((r) => String(r["Date"]).slice(0, 10)))].sort();
      for (const r of daily) {
        const asin = safeAsin(r["(Child) ASIN"] ?? r["ASIN"]);
        const date = String(r["Date"]).slice(0, 10);
        const key = `${asin}||${date}`;
        unitsBy.set(key, (unitsBy.get(key) ?? 0) + num(r["Units Ordered"]));
      }
    }

    const rows = baseline.map((b) => {
      const days: Record<string, number> = {};
      for (const d of dates) days[d] = unitsBy.get(`${b.asin}||${d}`) ?? 0;
      return { ...b, days, total: Object.values(days).reduce((s, v) => s + v, 0) };
    });

    return Response.json({
      baselineMonth: prevKey,
      missingBaseline: baseline.length === 0,
      dates,
      rows,
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
