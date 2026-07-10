import { loadChecklist, saveChecklist, loadHealth, aggregateHealth, CHECKLISTS } from "@/lib/health";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const month = url.searchParams.get("month");
  const asin = url.searchParams.get("asin");
  const targetUsp = Number(url.searchParams.get("targetUsp") ?? 0.08);
  if (!month || !asin) return Response.json({ error: "month and asin required" }, { status: 400 });

  try {
    const [all, saved] = await Promise.all([loadHealth(), loadChecklist()]);
    const calc = aggregateHealth(all, [month], targetUsp).find((r) => r.asin === asin);
    const type = calc?.opportunity === "High Traffic / Low Conv" ? "High Traffic / Low Conv" : "Low Traffic / Low Conv";
    const savedMap = new Map(
      saved.filter((r) => r.month === month && r.asin === asin).map((r) => [r.item, r.status]),
    );
    const items = CHECKLISTS[type].map((item) => ({ item, status: savedMap.get(item) ?? false }));
    return Response.json({ type, items, metrics: calc ?? null });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { month, asin, items } = await request.json();
  if (!month || !asin || !Array.isArray(items)) {
    return Response.json({ error: "month, asin, items required" }, { status: 400 });
  }
  try {
    await saveChecklist(String(month), String(asin), items);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
