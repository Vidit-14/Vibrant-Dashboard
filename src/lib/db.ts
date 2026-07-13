import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AdRow, TargetingRow, OrderRow, Country } from "./ads";
import type { LogEntry } from "./logs";
import type { CombinedRow } from "./returns";
import type { HealthRaw, ChecklistRow } from "./health";
import type { VocRow } from "./voc";
import type { AllowedUser, LoginEvent } from "./users";

/**
 * Supabase (Postgres) backend. Every function returns real data when
 * SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are configured; `usingSupabase()`
 * is false otherwise and the libs fall back to the Google Sheets code paths.
 *
 * Reads are deliberately NOT cached server-side: on serverless hosts each
 * instance has its own memory, so a per-instance cache serves stale data
 * after uploads. Postgres is fast enough to query directly.
 */

let client: SupabaseClient | null = null;

/** Accept both the bare project URL and the copied REST endpoint (…/rest/v1). */
export function normalizeSupabaseUrl(url: string): string {
  return url.trim().replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
}

export function usingSupabase(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function supa(): SupabaseClient {
  if (!client) {
    client = createClient(
      normalizeSupabaseUrl(process.env.SUPABASE_URL!),
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return client;
}

const PAGE = 1000;
const WAVE = 8; // parallel page requests

/**
 * Drain a PostgREST query past its 1000-row page cap. Pages are fetched in
 * parallel waves of 8, which matters when the function runs far from the DB.
 */
async function selectAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  // single probe first — most queries fit in one page
  const first = await build(0, PAGE - 1);
  if (first.error) throw new Error(first.error.message);
  const out: T[] = first.data ?? [];
  if (out.length < PAGE) return out;

  for (let wave = 0; ; wave++) {
    const batch = await Promise.all(
      Array.from({ length: WAVE }, (_, i) => {
        const from = (1 + wave * WAVE + i) * PAGE;
        return build(from, from + PAGE - 1);
      }),
    );
    let done = false;
    for (const { data, error } of batch) {
      if (error) throw new Error(error.message);
      if (data?.length) out.push(...data);
      if (!data || data.length < PAGE) done = true;
    }
    if (done) return out;
  }
}

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

/** Keep the last row per key — Postgres forbids duplicate keys in one upsert batch. */
function dedupeBy<T>(rows: T[], keyOf: (r: T) => string): T[] {
  const map = new Map<string, T>();
  for (const r of rows) map.set(keyOf(r), r);
  return [...map.values()];
}

/* ───────────────────────── ads ───────────────────────── */

export interface AdFilter { start?: string; end?: string; asin?: string; campaign?: string }

export async function dbQueryAds(country: Country, f: AdFilter = {}): Promise<AdRow[]> {
  return selectAll<AdRow>((from, to) => {
    let q = supa().from("ad_rows")
      .select("date,asin,campaign,spend,sales,orders,clicks,impressions")
      .eq("country", country);
    if (f.start) q = q.gte("date", f.start);
    if (f.end) q = q.lte("date", f.end);
    if (f.asin) q = q.eq("asin", f.asin);
    return q.order("date").order("id").range(from, to);
  });
}

export async function dbQueryTargeting(country: Country, f: AdFilter = {}): Promise<TargetingRow[]> {
  const rows = await selectAll<Omit<TargetingRow, "asin" | "matchType"> & { match_type: string }>((from, to) => {
    let q = supa().from("targeting_rows")
      .select("date,campaign,targeting,match_type,spend,sales,orders,clicks,impressions")
      .eq("country", country);
    if (f.start) q = q.gte("date", f.start);
    if (f.end) q = q.lte("date", f.end);
    if (f.campaign) q = q.eq("campaign", f.campaign);
    return q.order("date").order("id").range(from, to);
  });
  return rows.map((r) => ({ ...r, asin: "", matchType: r.match_type }));
}

export async function dbQueryOrders(f: AdFilter = {}): Promise<OrderRow[]> {
  return selectAll<OrderRow>((from, to) => {
    let q = supa().from("order_rows").select("date,sku,asin,units,sales").eq("country", "IND");
    if (f.start) q = q.gte("date", f.start);
    if (f.end) q = q.lte("date", f.end);
    if (f.asin) q = q.eq("asin", f.asin);
    return q.order("date").order("id").range(from, to);
  });
}

export async function dbInsertAds(country: Country, rows: AdRow[]) {
  const payload = rows.map((r) => ({ country, ...r }));
  for (let i = 0; i < payload.length; i += PAGE) {
    fail((await supa().from("ad_rows").insert(payload.slice(i, i + PAGE))).error);
  }
}

export async function dbInsertTargeting(country: Country, rows: TargetingRow[]) {
  const payload = rows.map(({ matchType, asin: _asin, ...r }) => ({ country, match_type: matchType, ...r }));
  for (let i = 0; i < payload.length; i += PAGE) {
    fail((await supa().from("targeting_rows").insert(payload.slice(i, i + PAGE))).error);
  }
}

export async function dbInsertOrders(rows: OrderRow[]) {
  const payload = rows.map((r) => ({ country: "IND", ...r }));
  for (let i = 0; i < payload.length; i += PAGE) {
    fail((await supa().from("order_rows").insert(payload.slice(i, i + PAGE))).error);
  }
}

export async function dbLatestAdDate(country: Country): Promise<string | null> {
  const { data, error } = await supa().from("ad_rows")
    .select("date").eq("country", country).order("date", { ascending: false }).limit(1);
  fail(error);
  return data?.[0]?.date ?? null;
}

export async function dbLatestOrderDate(): Promise<string | null> {
  const { data, error } = await supa().from("order_rows")
    .select("date").eq("country", "IND").order("date", { ascending: false }).limit(1);
  fail(error);
  return data?.[0]?.date ?? null;
}

/* ───────────────────────── change logs ───────────────────────── */

export async function dbLoadLogs(): Promise<LogEntry[]> {
  const rows = await selectAll<{ ts: string; asin: string; campaign: string; comment: string }>(
    (from, to) => supa().from("change_logs").select("ts,asin,campaign,comment").order("ts", { ascending: false }).range(from, to),
  );
  return rows.map((r) => ({ timestamp: r.ts, asin: r.asin, campaign: r.campaign, comment: r.comment }));
}

export async function dbAppendLog(asin: string, campaign: string, comment: string) {
  const expiry = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  fail((await supa().from("change_logs").insert({ asin, campaign, comment, expiry })).error);
}

/* ───────────────────────── users / auth ───────────────────────── */

export async function dbListAllowed(): Promise<AllowedUser[]> {
  const rows = await selectAll<{ email: string; added_by: string | null; added_at: string | null }>(
    (from, to) => supa().from("allowed_emails").select("email,added_by,added_at").order("email").range(from, to),
  );
  return rows.map((r) => ({ email: r.email, role: "member" as const, addedBy: r.added_by ?? "", addedAt: r.added_at ?? "" }));
}

export async function dbAddAllowed(email: string, addedBy: string) {
  fail((await supa().from("allowed_emails").insert({ email, role: "member", added_by: addedBy })).error);
}

export async function dbRemoveAllowed(email: string) {
  fail((await supa().from("allowed_emails").delete().eq("email", email)).error);
}

export async function dbRecordLogin(email: string, userAgent: string) {
  fail((await supa().from("login_events").insert({ email, user_agent: userAgent.slice(0, 200) })).error);
}

export async function dbListLoginEvents(): Promise<LoginEvent[]> {
  const rows = await selectAll<{ email: string; ts: string; user_agent: string | null }>(
    (from, to) => supa().from("login_events").select("email,ts,user_agent").order("ts", { ascending: false }).range(from, to),
  );
  return rows.map((r) => ({ email: r.email, timestamp: r.ts, userAgent: r.user_agent ?? "" }));
}

/* ───────────────────────── returns ───────────────────────── */

export async function dbLoadCombinedReturns(): Promise<CombinedRow[]> {
  const [returns, sales] = await Promise.all([
    selectAll<{ order_id: string; asin: string; disposition: string; reason: string; comments: string; return_date: string | null }>(
      (from, to) => supa().from("fba_returns").select("*").order("order_id").range(from, to),
    ),
    selectAll<{ order_id: string; buyer_email: string; title: string; pincode: string }>(
      (from, to) => supa().from("fulfilled_sales").select("order_id,buyer_email,title,pincode").order("order_id").range(from, to),
    ),
  ]);
  const byOrder = new Map(sales.map((s) => [s.order_id, s]));
  return returns
    .filter((r) => r.return_date)
    .map((r) => {
      const s = byOrder.get(r.order_id);
      return {
        date: r.return_date!,
        orderId: r.order_id,
        asin: r.asin,
        disposition: r.disposition,
        reason: r.reason,
        comments: r.comments,
        buyerEmail: s?.buyer_email ?? "",
        title: s?.title ?? "",
        pincode: (s?.pincode ?? "").split(".")[0],
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

export async function dbUpsertReturns(
  rows: { order_id: string; asin: string; disposition: string; reason: string; comments: string; return_date: string | null }[],
  sales: { order_id: string; date: string | null; buyer_email: string; title: string; pincode: string }[],
) {
  // Amazon reports repeat an order id per item — keep the last row per order,
  // matching the old Sheets dedupe (and Postgres's one-row-per-key upsert rule).
  const uniqRows = dedupeBy(rows, (r) => r.order_id);
  const uniqSales = dedupeBy(sales, (s) => s.order_id);
  for (let i = 0; i < uniqRows.length; i += PAGE) {
    fail((await supa().from("fba_returns").upsert(uniqRows.slice(i, i + PAGE), { onConflict: "order_id" })).error);
  }
  for (let i = 0; i < uniqSales.length; i += PAGE) {
    fail((await supa().from("fulfilled_sales").upsert(uniqSales.slice(i, i + PAGE), { onConflict: "order_id" })).error);
  }
}

/* ───────────────────────── sales tracker ───────────────────────── */

export async function dbTrackerBaseline(month: string) {
  const { data, error } = await supa().from("top_asins_monthly_avg")
    .select("asin,title,avg_daily_units").eq("month", month);
  fail(error);
  return (data ?? []).map((r) => ({ asin: r.asin, title: r.title, avg: r.avg_daily_units }));
}

export async function dbTrackerDaily(month: string) {
  // half-open range [month-01, nextMonth-01) — avoids invalid dates like Nov 31
  const [y, m] = month.split("-").map(Number);
  const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;
  return selectAll<{ date: string; asin: string; units: number }>((from, to) =>
    supa().from("business_reports_daily").select("date,asin,units")
      .gte("date", `${month}-01`).lt("date", next).order("date").order("asin").range(from, to),
  );
}

export async function dbReplaceMonthly(
  month: string,
  rows: { asin: string; title: string; units: number }[],
  top: { asin: string; title: string; avg: number }[],
) {
  fail((await supa().from("business_reports_monthly").delete().eq("month", month)).error);
  const payload = dedupeBy(rows, (r) => r.asin).map((r) => ({ month, ...r }));
  for (let i = 0; i < payload.length; i += PAGE) {
    fail((await supa().from("business_reports_monthly").upsert(payload.slice(i, i + PAGE), { onConflict: "month,asin" })).error);
  }
  fail((await supa().from("top_asins_monthly_avg").delete().eq("month", month)).error);
  fail((await supa().from("top_asins_monthly_avg").insert(
    dedupeBy(top, (t) => t.asin).map((t) => ({ month, asin: t.asin, title: t.title, avg_daily_units: t.avg })),
  )).error);
}

export async function dbReplaceDaily(date: string, rows: { asin: string; title: string; units: number }[]) {
  fail((await supa().from("business_reports_daily").delete().eq("date", date)).error);
  const payload = dedupeBy(rows, (r) => r.asin).map((r) => ({ date, ...r }));
  for (let i = 0; i < payload.length; i += PAGE) {
    fail((await supa().from("business_reports_daily").upsert(payload.slice(i, i + PAGE), { onConflict: "date,asin" })).error);
  }
}

/* ───────────────────────── asin health ───────────────────────── */

export async function dbLoadHealth(): Promise<HealthRaw[]> {
  const rows = await selectAll<{ month: string; asin: string; title: string; sales: number; units: number; sessions: number; usp: number; buy_box: number }>(
    (from, to) => supa().from("asin_health").select("*").order("month").order("asin").range(from, to),
  );
  return rows.map((r) => ({ ...r, buyBox: r.buy_box }));
}

export async function dbReplaceHealthMonth(month: string, rows: Omit<HealthRaw, "month">[]) {
  fail((await supa().from("asin_health").delete().eq("month", month)).error);
  const payload = dedupeBy(rows, (r) => r.asin).map(({ buyBox, ...r }) => ({ month, buy_box: buyBox, ...r }));
  for (let i = 0; i < payload.length; i += PAGE) {
    fail((await supa().from("asin_health").upsert(payload.slice(i, i + PAGE), { onConflict: "month,asin" })).error);
  }
}

export async function dbLoadChecklist(): Promise<ChecklistRow[]> {
  return selectAll<ChecklistRow>((from, to) =>
    supa().from("checklist_status").select("month,asin,item,status").order("month").order("asin").range(from, to),
  );
}

export async function dbSaveChecklist(month: string, asin: string, items: { item: string; status: boolean }[]) {
  fail((await supa().from("checklist_status").delete().eq("month", month).eq("asin", asin)).error);
  fail((await supa().from("checklist_status").insert(
    dedupeBy(items, (i) => i.item).map((i) => ({ month, asin, ...i })),
  )).error);
}

/* ─────────────── serverless-safe auth state (otp + presence) ─────────────── */

export interface OtpRecord { email: string; hash: string; expires: number; attempts: number; sentAt: number }

export async function dbGetOtp(email: string): Promise<OtpRecord | null> {
  const { data, error } = await supa().from("otp_codes").select("*").eq("email", email).maybeSingle();
  fail(error);
  if (!data) return null;
  return {
    email: data.email,
    hash: data.hash,
    expires: Date.parse(data.expires),
    attempts: data.attempts,
    sentAt: Date.parse(data.sent_at),
  };
}

export async function dbSetOtp(rec: OtpRecord) {
  fail((await supa().from("otp_codes").upsert({
    email: rec.email,
    hash: rec.hash,
    expires: new Date(rec.expires).toISOString(),
    attempts: rec.attempts,
    sent_at: new Date(rec.sentAt).toISOString(),
  }, { onConflict: "email" })).error);
}

export async function dbBumpOtpAttempts(email: string, attempts: number) {
  fail((await supa().from("otp_codes").update({ attempts }).eq("email", email)).error);
}

export async function dbDeleteOtp(email: string) {
  fail((await supa().from("otp_codes").delete().eq("email", email)).error);
}

export async function dbTouch(email: string) {
  fail((await supa().from("presence").upsert({ email, last_seen: new Date().toISOString() }, { onConflict: "email" })).error);
}

/** email → last_seen epoch ms */
export async function dbPresence(): Promise<Map<string, number>> {
  const { data, error } = await supa().from("presence").select("email,last_seen");
  fail(error);
  return new Map((data ?? []).map((r) => [r.email, Date.parse(r.last_seen)]));
}

/* ───────────────────────── voc ───────────────────────── */

export async function dbLoadVoc(): Promise<VocRow[]> {
  const rows = await selectAll<{
    snapshot_date: string; asin: string; product_name: string; sku: string; ncx_rate: string;
    ncx_orders: string; total_orders: string; star_rating: string; return_rate: string; top_reason: string; status: string;
  }>((from, to) => supa().from("voc_snapshots").select("*").order("snapshot_date").order("asin").range(from, to));
  return rows.map((r) => ({
    snapshotDate: r.snapshot_date,
    productName: r.product_name,
    asin: r.asin,
    sku: r.sku,
    ncxRate: r.ncx_rate,
    ncxOrders: r.ncx_orders,
    totalOrders: r.total_orders,
    starRating: r.star_rating,
    returnRate: r.return_rate,
    topReason: r.top_reason,
    status: r.status,
  }));
}

export async function dbSaveVocSnapshot(date: string, rows: Omit<VocRow, "snapshotDate">[]) {
  const payload = dedupeBy(rows, (r) => r.asin).map((r) => ({
    snapshot_date: date,
    asin: r.asin,
    product_name: r.productName,
    sku: r.sku,
    ncx_rate: r.ncxRate,
    ncx_orders: r.ncxOrders,
    total_orders: r.totalOrders,
    star_rating: r.starRating,
    return_rate: r.returnRate,
    top_reason: r.topReason,
    status: r.status,
  }));
  for (let i = 0; i < payload.length; i += PAGE) {
    fail((await supa().from("voc_snapshots").upsert(payload.slice(i, i + PAGE), { onConflict: "snapshot_date,asin" })).error);
  }
}
