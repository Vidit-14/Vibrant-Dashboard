import { loadHealth, aggregateHealth } from "@/lib/health";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const monthsParam = url.searchParams.get("months"); // comma-separated YYYY-MM
  const targetUsp = Number(url.searchParams.get("targetUsp") ?? 0.08);

  try {
    const all = await loadHealth();
    const available = [...new Set(all.map((r) => r.month))].sort().reverse();
    const months = monthsParam ? monthsParam.split(",").filter(Boolean) : available.slice(0, 1);
    const rows = aggregateHealth(all, months, targetUsp);
    return Response.json({ availableMonths: available, months, rows });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
