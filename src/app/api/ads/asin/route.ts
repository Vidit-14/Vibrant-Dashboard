import { loadAds, loadOrdersIND, inRange, type Country, COUNTRIES } from "@/lib/ads";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const country = (url.searchParams.get("country") ?? "IND") as Country;
  const asin = url.searchParams.get("asin");
  const start = url.searchParams.get("start")!;
  const end = url.searchParams.get("end")!;
  if (!asin || !COUNTRIES[country]) return Response.json({ error: "asin required" }, { status: 400 });

  try {
    const mine = (await loadAds(country, { asin })).filter((r) => r.asin === asin);
    const rows = inRange(mine, start, end);

    // ad vs organic sales (India only — needs the Orders report)
    let salesInsights: null | {
      adSales: number; adUnits: number; totalSales: number; totalUnits: number;
    } = null;
    if (country === "IND") {
      const orders = (await loadOrdersIND({ asin, start, end })).filter(
        (o) => o.asin === asin && o.date >= start && o.date <= end,
      );
      salesInsights = {
        adSales: rows.reduce((s, r) => s + r.sales, 0),
        adUnits: rows.reduce((s, r) => s + r.orders, 0),
        totalSales: orders.reduce((s, o) => s + o.sales, 0),
        totalUnits: orders.reduce((s, o) => s + o.units, 0),
      };
    }

    return Response.json({
      currency: COUNTRIES[country].currency,
      rows, // daily granularity; the client aggregates weekly/monthly
      campaigns: [...new Set(mine.map((r) => r.campaign))].sort(),
      salesInsights,
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
