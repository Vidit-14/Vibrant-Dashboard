/** Client-safe period helpers for daily/weekly/monthly aggregation. */

export type Period = "daily" | "weekly" | "monthly";

/** Map a YYYY-MM-DD date to its period bucket key. */
export function bucketOf(date: string, period: Period): string {
  if (period === "daily") return date;
  const d = new Date(date + "T00:00:00");
  if (period === "monthly") {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  }
  // weekly: Monday of the week (weeks ending Sunday, as in the original)
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface AggInput {
  date: string;
  spend: number;
  sales: number;
  orders: number;
  clicks: number;
  impressions: number;
}

export interface AggRow {
  period: string;
  spend: number;
  sales: number;
  orders: number;
  clicks: number;
  impressions: number;
  acos: number;
  roas: number;
  ctr: number;
  cvr: number;
}

/** Group rows by period bucket (+ optional secondary keys), with derived metrics. */
export function aggregate<T extends AggInput>(
  rows: T[],
  period: Period,
  keyOf?: (r: T) => string,
): (AggRow & { key: string })[] {
  const map = new Map<string, AggRow & { key: string }>();
  for (const r of rows) {
    const bucket = bucketOf(r.date, period);
    const key = keyOf ? keyOf(r) : "";
    const mapKey = `${bucket}||${key}`;
    let agg = map.get(mapKey);
    if (!agg) {
      agg = { period: bucket, key, spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0, acos: 0, roas: 0, ctr: 0, cvr: 0 };
      map.set(mapKey, agg);
    }
    agg.spend += r.spend;
    agg.sales += r.sales;
    agg.orders += r.orders;
    agg.clicks += r.clicks;
    agg.impressions += r.impressions;
  }
  const out = [...map.values()];
  for (const a of out) {
    a.acos = a.sales > 0 ? (a.spend / a.sales) * 100 : 0;
    a.roas = a.spend > 0 ? a.sales / a.spend : 0;
    a.ctr = a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0;
    a.cvr = a.clicks > 0 ? (a.orders / a.clicks) * 100 : 0;
  }
  return out.sort((a, b) => b.period.localeCompare(a.period));
}
