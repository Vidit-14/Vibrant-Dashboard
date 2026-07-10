import { getSheetValues, appendRows } from "@/lib/google";
import { invalidate } from "@/lib/cache";
import { toRecords, parseDate, num, dateKey, safeAsin, findCol } from "@/lib/parse";
import { parseUpload, adsDateString, toMatrix, type ParsedFile } from "@/lib/upload";
import { COUNTRIES, type Country, type AdRow, type TargetingRow, type OrderRow } from "@/lib/ads";
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
    return Response.json({ advLatest: adv, ordersLatest: orders });
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
  return Response.json({ advLatest: adv, ordersLatest: orders });
}

/* Normalizers: uploaded report records → clean typed rows (same rules as the loaders). */

function toAdRows(parsed: ParsedFile): AdRow[] {
  const salesCol = findCol(parsed.rows[0] as Record<string, string>, "14 day total sales");
  const out: AdRow[] = [];
  for (const r of parsed.rows) {
    const d = parseDate(String(r["Date"] ?? ""));
    if (!d) continue;
    out.push({
      date: dateKey(d),
      asin: safeAsin(String(r["Advertised ASIN"] ?? "")),
      campaign: String(r["Campaign Name"] ?? ""),
      spend: num(r["Spend"] as string),
      sales: salesCol ? num(r[salesCol] as string) : 0,
      orders: num(r["14 Day Total Orders (#)"] as string),
      clicks: num(r["Clicks"] as string),
      impressions: num(r["Impressions"] as string),
    });
  }
  return out;
}

function toTargetingRows(parsed: ParsedFile): TargetingRow[] {
  const salesCol = findCol(parsed.rows[0] as Record<string, string>, "14 day total sales");
  const out: TargetingRow[] = [];
  for (const r of parsed.rows) {
    const d = parseDate(String(r["Date"] ?? ""));
    if (!d) continue;
    out.push({
      date: dateKey(d),
      asin: "",
      campaign: String(r["Campaign Name"] ?? ""),
      targeting: String(r["Targeting"] ?? ""),
      matchType: String(r["Match Type"] ?? ""),
      spend: num(r["Spend"] as string),
      sales: salesCol ? num(r[salesCol] as string) : 0,
      orders: num(r["14 Day Total Orders (#)"] as string),
      clicks: num(r["Clicks"] as string),
      impressions: num(r["Impressions"] as string),
    });
  }
  return out;
}

function toOrderRows(parsed: ParsedFile): OrderRow[] {
  const out: OrderRow[] = [];
  for (const r of parsed.rows) {
    const d = parseDate(String(r["purchase-date"] ?? ""));
    if (!d) continue;
    const s = (k: string) => r[k] as string;
    out.push({
      date: dateKey(d),
      sku: String(r["sku"] ?? ""),
      asin: safeAsin(String(r["asin"] ?? "")),
      units: num(s("quantity")),
      sales:
        num(s("item-price")) + num(s("item-tax")) +
        num(s("shipping-price")) + num(s("shipping-tax")) +
        num(s("gift-wrap-price")) + num(s("gift-wrap-tax")) -
        num(s("item-promotion-discount")) - num(s("ship-promotion-discount")),
    });
  }
  return out;
}

/** POST multipart: adv (xlsx), tgt (xlsx), optional orders (xlsx/csv, India). */
export async function POST(request: Request) {
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
      const advRows = toAdRows(await parseUpload(adv));
      await dbInsertAds(country, advRows);
      results[`Advertised_product_${country}`] = advRows.length;

      const tgtRows = toTargetingRows(await parseUpload(tgt));
      await dbInsertTargeting(country, tgtRows);
      results[`Targeting_${country}`] = tgtRows.length;

      if (orders && country === "IND") {
        const orderRows = toOrderRows(await parseUpload(orders));
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
