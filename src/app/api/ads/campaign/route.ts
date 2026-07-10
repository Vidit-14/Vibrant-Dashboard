import { loadTargeting, type Country, COUNTRIES } from "@/lib/ads";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const country = (url.searchParams.get("country") ?? "IND") as Country;
  const campaign = url.searchParams.get("campaign");
  const start = url.searchParams.get("start")!;
  const end = url.searchParams.get("end")!;
  if (!campaign || !COUNTRIES[country]) return Response.json({ error: "campaign required" }, { status: 400 });

  try {
    const all = await loadTargeting(country, { campaign, start, end });
    const rows = all.filter((r) => r.campaign === campaign && r.date >= start && r.date <= end);
    return Response.json({
      currency: COUNTRIES[country].currency,
      rows,
      targets: [...new Set(rows.map((r) => r.targeting))].sort(),
      matchTypes: [...new Set(rows.map((r) => r.matchType))].sort(),
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
