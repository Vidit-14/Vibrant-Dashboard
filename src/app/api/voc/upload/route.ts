import { parseUpload } from "@/lib/upload";
import { saveSnapshot, cleanAsin, cleanStatus, STATUS_ORDER, VOC_COLS } from "@/lib/voc";

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file") as File | null;
  const date = form.get("date") as string; // YYYY-MM-DD
  if (!file || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) {
    return Response.json({ error: "file and date (YYYY-MM-DD) required" }, { status: 400 });
  }

  try {
    const parsed = await parseUpload(file);

    // case-insensitive header normalisation to the required columns
    const canon = new Map(VOC_COLS.map((c) => [c.toLowerCase(), c]));
    const rows = parsed.rows.map((r) => {
      const out: Record<string, string | number> = {};
      for (const [k, v] of Object.entries(r)) {
        out[canon.get(String(k).trim().toLowerCase()) ?? k] = v;
      }
      out["ASIN"] = cleanAsin(String(out["ASIN"] ?? ""));
      out["Status"] = cleanStatus(String(out["Status"] ?? ""));
      return out;
    });

    // one row per ASIN in this file — keep the worst status
    const rank = new Map(STATUS_ORDER.map((s, i) => [s, i]));
    const byAsin = new Map<string, Record<string, string | number>>();
    for (const r of rows) {
      const key = String(r["ASIN"]);
      const prev = byAsin.get(key);
      if (!prev || (rank.get(String(r["Status"])) ?? 999) < (rank.get(String(prev["Status"])) ?? 999)) {
        byAsin.set(key, r);
      }
    }

    await saveSnapshot([...byAsin.values()], date);
    return Response.json({ ok: true, rows: byAsin.size });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

// Vercel: allow up to 60s for large sheet/DB reads and file processing
export const maxDuration = 60;
