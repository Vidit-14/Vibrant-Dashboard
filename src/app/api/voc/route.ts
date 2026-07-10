import { loadSnapshots, STATUS_ORDER } from "@/lib/voc";

export async function GET() {
  try {
    const all = await loadSnapshots();
    const dates = [...new Set(all.map((r) => r.snapshotDate))].sort();
    const latest = dates[dates.length - 1] ?? null;
    const prev = dates.length >= 2 ? dates[dates.length - 2] : null;
    const current = latest ? all.filter((r) => r.snapshotDate === latest) : [];
    const previous = prev ? all.filter((r) => r.snapshotDate === prev) : [];

    // status changes since previous snapshot
    const rank = new Map(STATUS_ORDER.map((s, i) => [s, i]));
    const prevByAsin = new Map(previous.map((r) => [r.asin, r.status]));
    const changes = current
      .filter((r) => prevByAsin.has(r.asin) && prevByAsin.get(r.asin) !== r.status)
      .map((r) => {
        const from = prevByAsin.get(r.asin)!;
        const a = rank.get(from) ?? 999;
        const b = rank.get(r.status) ?? 999;
        return { asin: r.asin, from, to: r.status, direction: a < b ? "Improved" : a > b ? "Worsened" : "Changed" };
      });

    const currentAsins = new Set(current.map((r) => r.asin));
    const missing = previous.filter((r) => !currentAsins.has(r.asin)).map((r) => r.asin).sort();

    // counts per snapshot for the trend chart
    const trend = dates.map((d) => {
      const snap = all.filter((r) => r.snapshotDate === d);
      const counts: Record<string, number | string> = { date: d };
      for (const s of STATUS_ORDER) counts[s] = snap.filter((r) => r.status === s).length;
      return counts;
    });

    return Response.json({ latest, prev, current, changes, missing, trend, statusOrder: STATUS_ORDER });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

// Vercel: allow up to 60s for large sheet/DB reads and file processing
export const maxDuration = 60;
