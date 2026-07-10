/**
 * One-shot migration: Google Sheets (Dashboard_data) → Supabase Postgres.
 *
 * Prereqs:
 *   1. Run supabase/schema.sql in the Supabase SQL editor.
 *   2. Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in web/.env.local.
 *
 * Run from the web/ folder:  node scripts/migrate-to-supabase.mjs
 *
 * Safe to re-run: tables are wiped and refilled per run (the app is the only
 * writer, so this is a clean cutover, not a sync).
 */
import { readFileSync } from "node:fs";
import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";

/* ── env ─────────────────────────────────────────────────────────────── */
const env = {};
{
  const lines = readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Z_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    // multi-line double-quoted value (e.g. a PEM key spanning several lines)
    if (value.startsWith('"') && !(value.length > 1 && value.endsWith('"'))) {
      const parts = [value.slice(1)];
      while (++i < lines.length) {
        if (lines[i].trimEnd().endsWith('"')) {
          parts.push(lines[i].trimEnd().slice(0, -1));
          break;
        }
        parts.push(lines[i]);
      }
      env[m[1]] = parts.join("\n");
    } else {
      env[m[1]] = value.replace(/^"|"$/g, "");
    }
  }
}
for (const k of ["GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_PRIVATE_KEY", "SPREADSHEET_ID", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!env[k]) { console.error(`Missing ${k} in web/.env.local`); process.exit(1); }
}

// accept both the bare project URL and the copied REST endpoint (…/rest/v1)
const supaUrl = env.SUPABASE_URL.replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
const supa = createClient(supaUrl, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const auth = new google.auth.JWT({
  email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});
const sheets = google.sheets({ version: "v4", auth });

/* ── helpers (mirror src/lib/parse.ts) ───────────────────────────────── */
async function sheetRecords(name) {
  let values;
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: env.SPREADSHEET_ID, range: `'${name}'` });
    values = res.data.values ?? [];
  } catch {
    console.log(`  (sheet "${name}" not found — skipping)`);
    return [];
  }
  if (!values.length) return [];
  const seen = new Map();
  const headers = values[0].map((h) => {
    let n = String(h ?? "").trim();
    if (!n) n = `_empty_${seen.size}`;
    const c = seen.get(n);
    if (c !== undefined) { seen.set(n, c + 1); return `${n}_${c + 1}`; }
    seen.set(n, 0);
    return n;
  });
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const rec = {};
    let blank = true;
    for (let j = 0; j < headers.length; j++) {
      const v = String(values[i]?.[j] ?? "").trim();
      if (v) blank = false;
      if (!headers[j].startsWith("_empty_")) rec[headers[j]] = v;
    }
    if (!blank) out.push(rec);
  }
  return out;
}

const num = (v) => {
  const n = parseFloat(String(v ?? "").replace(/[₹$,%\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const safeAsin = (v) => {
  const s = String(v ?? "").trim();
  return s.endsWith(".0") && /^-?\d+$/.test(s.slice(0, -2)) ? s.slice(0, -2) : s;
};
const dateKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseDay = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : dateKey(d);
};
const findCol = (rec, needle) =>
  rec ? Object.keys(rec).find((k) => k.toLowerCase().includes(needle.toLowerCase())) ?? null : null;

async function refill(table, rows, { wipe = true } = {}) {
  if (wipe) {
    const del = supa.from(table).delete();
    // delete all rows regardless of pk shape
    const { error } = await ("id" in (rows[0] ?? {}) ? del.gte("id", 0) : del.neq("__never", "x"));
    if (error && !/column/.test(error.message)) throw new Error(`${table} wipe: ${error.message}`);
  }
  for (let i = 0; i < rows.length; i += 1000) {
    const { error } = await supa.from(table).insert(rows.slice(i, i + 1000));
    if (error) throw new Error(`${table} insert: ${error.message}`);
  }
  console.log(`  ${table}: ${rows.length} rows`);
}

/* ── migrations ──────────────────────────────────────────────────────── */

async function migrateAds(country) {
  console.log(`Ads (${country})…`);
  const recs = await sheetRecords(`Advertised_product_${country}`);
  const salesCol = findCol(recs[0], "14 day total sales");
  const rows = recs.flatMap((r) => {
    const date = parseDay(r["Date"]);
    if (!date) return [];
    return [{
      country, date,
      asin: safeAsin(r["Advertised ASIN"]),
      campaign: r["Campaign Name"] ?? "",
      spend: num(r["Spend"]), sales: salesCol ? num(r[salesCol]) : 0,
      orders: num(r["14 Day Total Orders (#)"]), clicks: num(r["Clicks"]), impressions: num(r["Impressions"]),
    }];
  });
  const { error } = await supa.from("ad_rows").delete().eq("country", country);
  if (error) throw new Error(error.message);
  await refill("ad_rows", rows, { wipe: false });

  const trecs = await sheetRecords(`Targeting_${country}`);
  const tSalesCol = findCol(trecs[0], "14 day total sales");
  const trows = trecs.flatMap((r) => {
    const date = parseDay(r["Date"]);
    if (!date) return [];
    return [{
      country, date,
      campaign: r["Campaign Name"] ?? "",
      targeting: r["Targeting"] ?? "", match_type: r["Match Type"] ?? "",
      spend: num(r["Spend"]), sales: tSalesCol ? num(r[tSalesCol]) : 0,
      orders: num(r["14 Day Total Orders (#)"]), clicks: num(r["Clicks"]), impressions: num(r["Impressions"]),
    }];
  });
  const { error: e2 } = await supa.from("targeting_rows").delete().eq("country", country);
  if (e2) throw new Error(e2.message);
  await refill("targeting_rows", trows, { wipe: false });
}

async function migrateOrders() {
  console.log("Orders (IND)…");
  const recs = await sheetRecords("Orders_IND");
  const rows = recs.flatMap((r) => {
    const date = parseDay(r["purchase-date"]);
    if (!date) return [];
    return [{
      country: "IND", date,
      sku: r["sku"] ?? "", asin: safeAsin(r["asin"]), units: num(r["quantity"]),
      sales:
        num(r["item-price"]) + num(r["item-tax"]) + num(r["shipping-price"]) + num(r["shipping-tax"]) +
        num(r["gift-wrap-price"]) + num(r["gift-wrap-tax"]) -
        num(r["item-promotion-discount"]) - num(r["ship-promotion-discount"]),
    }];
  });
  const { error } = await supa.from("order_rows").delete().eq("country", "IND");
  if (error) throw new Error(error.message);
  await refill("order_rows", rows, { wipe: false });
}

async function migrateLogs() {
  console.log("Change logs…");
  const recs = await sheetRecords("ASIN Selections (log changes)");
  const rows = recs.flatMap((r) => {
    const ts = r["Timestamp"];
    if (!ts) return [];
    let d = new Date(ts);
    if (Number.isNaN(d.getTime())) {
      const m = ts.match(/^(\d{1,2})-(\d{1,2})-(\d{4})(.*)$/);
      if (m) d = new Date(`${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}${m[4]}`);
    }
    if (Number.isNaN(d.getTime())) return [];
    return [{ ts: d.toISOString(), asin: safeAsin(r["ASIN"]), campaign: r["Campaign"] ?? "", comment: r["Comment"] ?? "" }];
  });
  await refill("change_logs", rows);
}

async function migrateReturns() {
  console.log("Returns…");
  const recs = await sheetRecords("FBA-Returns-Data");
  const seen = new Map();
  for (const r of recs) {
    const id = String(r["Order Id"] ?? "").trim();
    if (!id) continue;
    seen.set(id, {
      order_id: id, asin: safeAsin(r["ASIN"]),
      disposition: r["detailed-disposition"] ?? "", reason: r["reason"] ?? "",
      comments: r["customer-comments"] ?? "", return_date: parseDay(r["Date"]) ?? parseDay(r["return-date"]),
    });
  }
  await refill("fba_returns", [...seen.values()]);

  const srecs = await sheetRecords("Fulfilled-Sales-Data");
  const sSeen = new Map();
  for (const r of srecs) {
    const id = String(r["Order Id"] ?? "").trim();
    if (!id) continue;
    const d = r["Date"] ? new Date(r["Date"]) : null;
    sSeen.set(id, {
      order_id: id,
      date: d && !Number.isNaN(d.getTime()) ? d.toISOString() : null,
      buyer_email: r["Buyer Email"] ?? "", title: r["Title"] ?? "",
      pincode: String(r["Shipping Postal Code"] ?? "").split(".")[0],
    });
  }
  await refill("fulfilled_sales", [...sSeen.values()]);
}

async function migrateTracker() {
  console.log("Sales tracker…");
  const monthly = await sheetRecords("Business_Reports_Monthly");
  const mMap = new Map();
  for (const r of monthly) {
    const month = String(r["Month"] ?? "").slice(0, 7);
    const asin = safeAsin(r["(Child) ASIN"] ?? r["ASIN"]);
    if (!/^\d{4}-\d{2}$/.test(month) || !asin) continue;
    const key = `${month}|${asin}`;
    const e = mMap.get(key) ?? { month, asin, title: r["Title"] ?? "", units: 0 };
    e.units += num(r["Units Ordered"]);
    mMap.set(key, e);
  }
  await refill("business_reports_monthly", [...mMap.values()]);

  const daily = await sheetRecords("Business_Reports_Daily");
  const dMap = new Map();
  for (const r of daily) {
    const date = String(r["Date"] ?? "").slice(0, 10);
    const asin = safeAsin(r["(Child) ASIN"] ?? r["ASIN"]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !asin) continue;
    const key = `${date}|${asin}`;
    const e = dMap.get(key) ?? { date, asin, title: r["Title"] ?? "", units: 0 };
    e.units += num(r["Units Ordered"]);
    dMap.set(key, e);
  }
  await refill("business_reports_daily", [...dMap.values()]);

  const avg = await sheetRecords("Top_ASINs_Monthly_Avg");
  const aMap = new Map();
  for (const r of avg) {
    const month = String(r["Month"] ?? "").slice(0, 7);
    const asin = safeAsin(r["ASIN"]);
    if (!/^\d{4}-\d{2}$/.test(month) || !asin) continue;
    aMap.set(`${month}|${asin}`, { month, asin, title: r["Title"] ?? "", avg_daily_units: num(r["Avg Daily Units"]) });
  }
  await refill("top_asins_monthly_avg", [...aMap.values()]);
}

async function migrateHealth() {
  console.log("ASIN health…");
  const recs = await sheetRecords("ASIN_Health_Data");
  const map = new Map();
  for (const r of recs) {
    const month = String(r["Month"] ?? "").slice(0, 7);
    const asin = safeAsin(r["(Child) ASIN"] ?? r["ASIN"]);
    if (!/^\d{4}-\d{2}$/.test(month) || !asin) continue;
    map.set(`${month}|${asin}`, {
      month, asin, title: r["Title"] ?? "",
      sales: num(r["Ordered Product Sales"]), units: num(r["Units Ordered"]),
      sessions: num(r["Sessions - Total"]), usp: num(r["Unit Session Percentage"]),
      buy_box: num(r["Featured Offer Percentage"]),
    });
  }
  await refill("asin_health", [...map.values()]);

  const checks = await sheetRecords("ASIN_Checklist_Status");
  const cMap = new Map();
  for (const r of checks) {
    const month = String(r["Month"] ?? "").slice(0, 7);
    const asin = safeAsin(r["ASIN"]);
    const item = r["Checklist Item"] ?? "";
    if (!month || !asin || !item) continue;
    cMap.set(`${month}|${asin}|${item}`, {
      month, asin, item,
      status: ["true", "t", "1", "yes", "y"].includes(String(r["Status"]).trim().toLowerCase()),
    });
  }
  await refill("checklist_status", [...cMap.values()]);
}

async function migrateVoc() {
  console.log("VOC snapshots…");
  const ORDER = ["Very poor", "Poor", "Fair", "Good", "Excellent"];
  const rank = new Map(ORDER.map((s, i) => [s, i]));
  const clean = (x) => {
    const s = String(x).replace(/ /g, " ").replace(/[-_]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
    const hit = ORDER.find((o) => o.toLowerCase() === s);
    return hit ?? s.replace(/\b\w/g, (c) => c.toUpperCase());
  };
  const recs = await sheetRecords("VOC_Status_Snapshots");
  const map = new Map();
  for (const r of recs) {
    const date = parseDay(r["Snapshot Date"]);
    const asin = String(r["ASIN"] ?? "").trim().toUpperCase();
    if (!date || !asin) continue;
    const row = {
      snapshot_date: date, asin,
      product_name: r["Product name"] ?? "", sku: r["SKU"] ?? "",
      ncx_rate: r["NCX rate"] ?? "", ncx_orders: r["NCX orders"] ?? "",
      total_orders: r["Total orders"] ?? "", star_rating: r["Star rating"] ?? "",
      return_rate: r["Return rate"] ?? "", top_reason: r["Top NCX reason"] ?? "",
      status: clean(r["Status"] ?? ""),
    };
    const key = `${date}|${asin}`;
    const prev = map.get(key);
    if (!prev || (rank.get(row.status) ?? 999) < (rank.get(prev.status) ?? 999)) map.set(key, row);
  }
  await refill("voc_snapshots", [...map.values()]);
}

async function migrateUsers() {
  console.log("Access control…");
  const allowed = await sheetRecords("App_Allowed_Emails");
  const aMap = new Map();
  for (const r of allowed) {
    const email = String(r["Email"] ?? "").trim().toLowerCase();
    if (!email) continue;
    aMap.set(email, { email, role: "member", added_by: r["Added By"] ?? "", added_at: r["Added At"] || new Date().toISOString() });
  }
  await refill("allowed_emails", [...aMap.values()]);

  const events = await sheetRecords("App_Login_Events");
  const eRows = events.flatMap((r) => {
    const d = new Date(r["Timestamp"]);
    if (Number.isNaN(d.getTime())) return [];
    return [{ email: String(r["Email"] ?? "").trim().toLowerCase(), ts: d.toISOString(), user_agent: r["User Agent"] ?? "" }];
  });
  await refill("login_events", eRows);
}

/* ── run ─────────────────────────────────────────────────────────────── */
console.log("Migrating Google Sheets → Supabase…\n");
try {
  await migrateAds("IND");
  await migrateAds("USA");
  await migrateOrders();
  await migrateLogs();
  await migrateReturns();
  await migrateTracker();
  await migrateHealth();
  await migrateVoc();
  await migrateUsers();
  console.log("\n✅ Migration complete. The app will use Supabase automatically (SUPABASE_URL is set).");
  console.log("   Keep the Google Sheet as a read-only archive — the app no longer writes to it.");
} catch (e) {
  console.error("\n❌ Migration failed:", e.message);
  process.exit(1);
}
