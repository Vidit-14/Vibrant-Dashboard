import { getSheetValues, appendRows } from "@/lib/google";
import { invalidate } from "@/lib/cache";
import { toRecords, parseDate } from "@/lib/parse";
import { parseUpload, adsDateString, toMatrix } from "@/lib/upload";
import { COUNTRIES, type Country, type AdRow, type TargetingRow, type OrderRow } from "@/lib/ads";
import { toAdRows, toTargetingRows, toOrderRows, UPLOAD_CHUNK } from "@/lib/ads-upload";
import {
  usingSupabase, dbInsertAds, dbInsertTargeting, dbInsertOrders,
  dbLatestAdDate, dbLatestOrderDate,
} from "@/lib/db";

/** GET → latest dates already present, so the UI can tell the user what period to export. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const country = (url.searchParams.get("country") ?? "IND") as Country;
  if (!COUNTRIES[country]) return Response.json({ error: "bad country" }, { status: 400 });

  if (usingSupabase()) {
    const [adv, orders] = await Promise.all([
      dbLatestAdDate(country),
      country === "IND" ? dbLatestOrderDate() : Promise.resolve(null),
    ]);
    return Response.json({ advLatest: adv, ordersLatest: orders, backend: "db" });
  }

  async function latest(sheet: string, dateCol: string): Promise<string | null> {
    try {
      const recs = toRecords(await getSheetValues(sheet));
      let max: Date | null = null;
      for (const r of recs) {
        const d = parseDate(r[dateCol]);
        if (d && (!max || d > max)) max = d;
      }
      return max ? max.toISOString().slice(0, 10) : null;
    } catch {
      return null;
    }
  }

  const [adv, orders] = await Promise.all([
    latest(`Advertised_product_${country}`, "Date"),
    country === "IND" ? latest("Orders_IND", "purchase-date") : Promise.resolve(null),
  ]);
  return Response.json({ advLatest: adv, ordersLatest: orders, backend: "sheets" });
}

/* JSON chunk branch: the browser parses the xlsx locally and streams typed rows
   in chunks, so no request ever hits Vercel's ~4.5 MB body limit. Rows are
   re-mapped field by field — never spread raw client JSON into the DB. */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown) => String(v ?? "");
const fin = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

interface ChunkBody { country: Country; kind: "adv" | "tgt" | "orders"; rows: Record<string, unknown>[] }

async function handleChunk(request: Request): Promise<Response> {
  const { country, kind, rows } = (await request.json()) as ChunkBody;
  if (!COUNTRIES[country]) return Response.json({ error: "bad country" }, { status: 400 });
  if (!usingSupabase()) return Response.json({ error: "Chunked upload requires the database backend" }, { status: 400 });
  if (!Array.isArray(rows) || rows.length > UPLOAD_CHUNK * 2) {
    return Response.json({ error: "bad rows payload" }, { status: 400 });
  }

  const dated = rows.filter((r) => DATE_RE.test(str(r.date)));
  if (kind === "adv") {
    const clean: AdRow[] = dated.map((r) => ({
      date: str(r.date), asin: str(r.asin), campaign: str(r.campaign),
      spend: fin(r.spend), sales: fin(r.sales), orders: fin(r.orders),
      clicks: fin(r.clicks), impressions: fin(r.impressions),
    }));
    await dbInsertAds(country, clean);
  } else if (kind === "tgt") {
    const clean: TargetingRow[] = dated.map((r) => ({
      date: str(r.date), asin: "", campaign: str(r.campaign),
      targeting: str(r.targeting), matchType: str(r.matchType),
      spend: fin(r.spend), sales: fin(r.sales), orders: fin(r.orders),
      clicks: fin(r.clicks), impressions: fin(r.impressions),
    }));
    await dbInsertTargeting(country, clean);
  } else if (kind === "orders") {
    if (country !== "IND") return Response.json({ error: "orders are India-only" }, { status: 400 });
    const clean: OrderRow[] = dated.map((r) => ({
      date: str(r.date), sku: str(r.sku), asin: str(r.asin),
      units: fin(r.units), sales: fin(r.sales),
    }));
    await dbInsertOrders(clean);
  } else {
    return Response.json({ error: "bad kind" }, { status: 400 });
  }
  return Response.json({ ok: true, inserted: dated.length });
}

/** POST — JSON: one chunk of pre-parsed rows; multipart: adv/tgt/orders files (Sheets or small uploads). */
export async function POST(request: Request) {
  if (request.headers.get("content-type")?.includes("application/json")) {
    try {
      return await handleChunk(request);
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  const form = await request.formData();
  const country = (form.get("country") as string) as Country;
  const adv = form.get("adv") as File | null;
  const tgt = form.get("tgt") as File | null;
  const orders = form.get("orders") as File | null;
  if (!COUNTRIES[country]) return Response.json({ error: "bad country" }, { status: 400 });
  if (!adv || !tgt) return Response.json({ error: "Both Advertised Product and Targeting reports are required" }, { status: 400 });

  try {
    const results: Record<string, number> = {};

    if (usingSupabase()) {
      const advRows = toAdRows((await parseUpload(adv)).rows);
      await dbInsertAds(country, advRows);
      results[`Advertised_product_${country}`] = advRows.length;

      const tgtRows = toTargetingRows((await parseUpload(tgt)).rows);
      await dbInsertTargeting(country, tgtRows);
      results[`Targeting_${country}`] = tgtRows.length;

      if (orders && country === "IND") {
        const orderRows = toOrderRows((await parseUpload(orders)).rows);
        await dbInsertOrders(orderRows);
        results["Orders_IND"] = orderRows.length;
      }
      return Response.json({ ok: true, appended: results });
    }

    for (const [file, sheet] of [
      [adv, `Advertised_product_${country}`],
      [tgt, `Targeting_${country}`],
    ] as [File, string][]) {
      const parsed = await parseUpload(file);
      // keep the sheet's own column order so appended rows line up with the header
      const sheetHeader = (await getSheetValues(sheet))[0]?.map((h) => String(h).trim()) ?? parsed.headers;
      for (const r of parsed.rows) {
        if (r["Date"]) r["Date"] = adsDateString(String(r["Date"]));
      }
      const matrix = toMatrix(parsed.rows, sheetHeader);
      if (matrix.length) await appendRows(sheet, matrix);
      results[sheet] = matrix.length;
    }

    if (orders && country === "IND") {
      const parsed = await parseUpload(orders);
      const sheetHeader = (await getSheetValues("Orders_IND"))[0]?.map((h) => String(h).trim()) ?? parsed.headers;
      const matrix = toMatrix(parsed.rows, sheetHeader);
      if (matrix.length) await appendRows("Orders_IND", matrix);
      results["Orders_IND"] = matrix.length;
    }

    invalidate(`ads:${country}`, `targeting:${country}`, "orders:IND");
    return Response.json({ ok: true, appended: results });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

// Vercel: allow up to 60s for large sheet/DB reads and file processing
export const maxDuration = 60;
