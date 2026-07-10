import { parseUpload } from "@/lib/upload";
import { updateRawSheet, regenerateCombined, RETURNS_SHEET, SALES_SHEET, RETURNS_COLS, SALES_COLS } from "@/lib/returns";
import { parseDate, dateKey } from "@/lib/parse";
import { usingSupabase, dbUpsertReturns } from "@/lib/db";

export async function POST(request: Request) {
  const form = await request.formData();
  const returnsFile = form.get("returns") as File | null;
  const salesFile = form.get("sales") as File | null;
  if (!returnsFile || !salesFile) {
    return Response.json({ error: "Both FBA Returns and Fulfilled Sales files are required" }, { status: 400 });
  }

  try {
    if (usingSupabase()) {
      const ret = await parseUpload(returnsFile);
      const retRows = ret.rows
        .filter((r) => String(r["order-id"] ?? "").trim())
        .map((r) => {
          const d = parseDate(String(r["return-date"] ?? ""));
          return {
            order_id: String(r["order-id"]).trim(),
            asin: String(r["asin"] ?? ""),
            disposition: String(r["detailed-disposition"] ?? ""),
            reason: String(r["reason"] ?? ""),
            comments: String(r["customer-comments"] ?? ""),
            return_date: d ? dateKey(d) : null,
          };
        });
      const sal = await parseUpload(salesFile);
      const salRows = sal.rows
        .filter((r) => String(r["Amazon Order Id"] ?? "").trim())
        .map((r) => {
          const d = parseDate(String(r["Payments Date"] ?? ""));
          return {
            order_id: String(r["Amazon Order Id"]).trim(),
            date: d ? d.toISOString() : null,
            buyer_email: String(r["Buyer Email"] ?? ""),
            title: String(r["Title"] ?? ""),
            pincode: String(r["Shipping Postal Code"] ?? "").split(".")[0],
          };
        });
      await dbUpsertReturns(retRows, salRows);
      return Response.json({ ok: true, returns: retRows.length, sales: salRows.length });
    }
    // FBA returns: order-id, asin, detailed-disposition, reason, customer-comments, return-date
    const ret = await parseUpload(returnsFile);
    const retRows = ret.rows.map((r) => {
      const d = parseDate(String(r["return-date"] ?? ""));
      return {
        "Order Id": r["order-id"] ?? "",
        ASIN: r["asin"] ?? "",
        "detailed-disposition": r["detailed-disposition"] ?? "",
        reason: r["reason"] ?? "",
        "customer-comments": r["customer-comments"] ?? "",
        "return-date": r["return-date"] ?? "",
        Date: d ? dateKey(d) : "",
      };
    });
    await updateRawSheet(RETURNS_SHEET, RETURNS_COLS, retRows, "Order Id");

    // Fulfilled sales: Amazon Order Id, Payments Date, Buyer Email, Title, Shipping Postal Code
    const sal = await parseUpload(salesFile);
    const salRows = sal.rows.map((r) => ({
      "Order Id": r["Amazon Order Id"] ?? "",
      Date: r["Payments Date"] ?? "",
      "Buyer Email": r["Buyer Email"] ?? "",
      Title: r["Title"] ?? "",
      "Shipping Postal Code": r["Shipping Postal Code"] ?? "",
    }));
    await updateRawSheet(SALES_SHEET, SALES_COLS, salRows, "Order Id");

    await regenerateCombined();
    return Response.json({ ok: true, returns: retRows.length, sales: salRows.length });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

// Vercel: allow up to 60s for large sheet/DB reads and file processing
export const maxDuration = 60;
