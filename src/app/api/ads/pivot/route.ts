import { loadAds, sumRows, inRange, type Country, COUNTRIES } from "@/lib/ads";
import { getActiveLoggedPairs, pairKey } from "@/lib/logs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const country = (url.searchParams.get("country") ?? "IND") as Country;
  const start = url.searchParams.get("start")!;
  const end = url.searchParams.get("end")!;
  if (!COUNTRIES[country] || !start || !end) {
    return Response.json({ error: "country, start, end required" }, { status: 400 });
  }

  try {
    // previous window of equal length, for KPI deltas
    const days = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
    const prevEnd = new Date(Date.parse(start) - 86400000);
    const prevStart = new Date(prevEnd.getTime() - (days - 1) * 86400000);
    const iso = (d: Date) => d.toISOString().slice(0, 10);

    const [all, loggedPairs] = await Promise.all([
      loadAds(country, { start: iso(prevStart), end }), // pushed to SQL on Supabase
      getActiveLoggedPairs(),
    ]);
    const rows = inRange(all, start, end);
    const prevRows = inRange(all, iso(prevStart), iso(prevEnd));

    const dates = [...new Set(rows.map((r) => r.date))].sort().reverse();

    type Pair = {
      asin: string; campaign: string;
      spend: number; sales: number; orders: number; clicks: number; impressions: number;
      days: Record<string, { s: number; o: number }>;
    };
    const pairs = new Map<string, Pair>();
    for (const r of rows) {
      const key = pairKey(r.asin, r.campaign);
      let p = pairs.get(key);
      if (!p) {
        p = { asin: r.asin, campaign: r.campaign, spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0, days: {} };
        pairs.set(key, p);
      }
      p.spend += r.spend; p.sales += r.sales; p.orders += r.orders;
      p.clicks += r.clicks; p.impressions += r.impressions;
      const day = (p.days[r.date] ??= { s: 0, o: 0 });
      day.s += r.spend; day.o += r.orders;
    }

    let wastedTotal = 0;
    const wastedPairs: { asin: string; campaign: string; spend: number }[] = [];
    for (const p of pairs.values()) {
      let w = 0;
      for (const d of Object.values(p.days)) if (d.s > 0 && d.o === 0) w += d.s;
      if (w > 0) {
        wastedTotal += w;
        wastedPairs.push({ asin: p.asin, campaign: p.campaign, spend: w });
      }
    }
    const wastedTop = wastedPairs.sort((a, b) => b.spend - a.spend).slice(0, 5);

    const list = [...pairs.values()]
      .map((p) => ({
        ...p,
        acos: p.sales > 0 ? (p.spend / p.sales) * 100 : p.spend > 0 ? Infinity : 0,
        logged: loggedPairs.has(pairKey(p.asin, p.campaign)),
      }))
      .sort((a, b) => (b.acos === Infinity ? 1e12 : b.acos) - (a.acos === Infinity ? 1e12 : a.acos))
      .map((p) => ({ ...p, acos: Number.isFinite(p.acos) ? p.acos : 0 }));

    return Response.json({
      currency: COUNTRIES[country].currency,
      dates,
      rows: list,
      totals: sumRows(rows),
      prevTotals: sumRows(prevRows),
      wasted: { total: wastedTotal, top: wastedTop },
      asins: [...new Set(rows.map((r) => r.asin))].sort(),
      campaigns: [...new Set(rows.map((r) => r.campaign))].sort(),
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

// Vercel: allow up to 60s for large sheet/DB reads and file processing
export const maxDuration = 60;
