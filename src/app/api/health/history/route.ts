import { loadHealth } from "@/lib/health";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const asin = url.searchParams.get("asin");
  if (!asin) return Response.json({ error: "asin required" }, { status: 400 });
  try {
    const all = await loadHealth();
    const history = all
      .filter((r) => r.asin === asin)
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((r) => ({ month: r.month, units: r.units, sales: r.sales, sessions: r.sessions, usp: r.usp }));
    return Response.json({ history });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
