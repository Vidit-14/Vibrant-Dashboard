import { loadLogs, appendLog } from "@/lib/logs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const days = Number(url.searchParams.get("days") ?? 7);
  try {
    const logs = await loadLogs();
    const cutoff = Date.now() - days * 86400000;
    return Response.json({ logs: logs.filter((l) => Date.parse(l.timestamp) >= cutoff) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { asin, campaign, comment } = await request.json();
  if (!comment || (!asin && !campaign)) {
    return Response.json({ error: "asin/campaign and comment required" }, { status: 400 });
  }
  try {
    await appendLog(String(asin ?? ""), String(campaign ?? ""), String(comment));
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
