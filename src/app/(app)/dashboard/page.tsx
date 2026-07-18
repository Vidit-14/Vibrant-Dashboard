"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useApi, fmt, postJson, postForm } from "@/lib/client";
import { DateRangePicker, MultiSelect, useDateRange } from "@/components/filters";
import { Button, Card, Dialog, EmptyState, ErrorNote, Field, Kpi, PageHeader, Pill, Spinner, inputCls } from "@/components/ui";
import { ClipboardList, Upload, Flame, ExternalLink, PencilLine } from "lucide-react";
import clsx from "clsx";

interface PivotRow {
  asin: string; campaign: string;
  spend: number; sales: number; orders: number; acos: number; logged: boolean;
  days: Record<string, { s: number; o: number }>;
}
interface Totals { spend: number; sales: number; orders: number; acos: number }
interface PivotData {
  currency: string;
  dates: string[];
  rows: PivotRow[];
  totals: Totals;
  prevTotals: Totals;
  wasted: { total: number; top: { asin: string; campaign: string; spend: number }[] };
  asins: string[];
  campaigns: string[];
}
interface LogEntry { timestamp: string; asin: string; campaign: string; comment: string }

function delta(curr: number, prev: number): number | null {
  if (!prev) return null;
  return ((curr - prev) / prev) * 100;
}

/** Efficiency color for a (spend, orders) day cell — mirrors the original legend. */
function cellStyle(s: number, o: number): { bg: string; fg: string } | null {
  if (s <= 0) return null;
  if (o === 0) return { bg: "var(--chart-5)", fg: "#fff" };
  const ratio = s / o;
  if (ratio > 15) return { bg: "var(--status-critical)", fg: "#fff" };
  if (ratio > 7.5) return { bg: "var(--chart-1)", fg: "#fff" };
  return { bg: "var(--status-good)", fg: "#fff" };
}

const LEGEND = [
  { label: "Spend, no orders", color: "var(--chart-5)" },
  { label: "Spend/Orders > 15", color: "var(--status-critical)" },
  { label: "7.5 – 15", color: "var(--chart-1)" },
  { label: "< 7.5", color: "var(--status-good)" },
];

export default function DashboardPage() {
  const [country, setCountry] = useState<"IND" | "USA">("IND");
  const { range, setRange, ready } = useDateRange(30);
  const [asinFilter, setAsinFilter] = useState<string[]>([]);
  const [campaignFilter, setCampaignFilter] = useState<string[]>([]);
  const [logTarget, setLogTarget] = useState<PivotRow | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [showUpload, setShowUpload] = useState(false);

  const { data, error, loading, refresh } = useApi<PivotData>(
    ready ? `/api/ads/pivot?country=${country}&start=${range.start}&end=${range.end}` : null,
  );

  const rows = useMemo(() => {
    if (!data) return [];
    return data.rows.filter(
      (r) =>
        (asinFilter.length === 0 || asinFilter.includes(r.asin)) &&
        (campaignFilter.length === 0 || campaignFilter.includes(r.campaign)),
    );
  }, [data, asinFilter, campaignFilter]);

  const cur = data?.currency ?? "₹";
  const filteredTotals = useMemo(() => {
    const t = { spend: 0, sales: 0, orders: 0 };
    for (const r of rows) { t.spend += r.spend; t.sales += r.sales; t.orders += r.orders; }
    return t;
  }, [rows]);

  return (
    <div>
      <PageHeader title="Ads Dashboard" subtitle="ASIN × campaign ad performance">
        <select
          value={country}
          onChange={(e) => setCountry(e.target.value as "IND" | "USA")}
          className="glass h-9 rounded-xl px-3 text-[13px] font-medium"
        >
          <option value="IND">🇮🇳 India</option>
          <option value="USA">🇺🇸 USA</option>
        </select>
        <DateRangePicker value={range} onChange={setRange} />
        <Button variant="ghost" onClick={() => setShowLogs(true)}>
          <ClipboardList className="size-4" /> Change logs
        </Button>
        <Button onClick={() => setShowUpload(true)}>
          <Upload className="size-4" /> Upload reports
        </Button>
      </PageHeader>

      {error && <ErrorNote message={error} />}
      {(loading || !ready) && <Spinner label="Loading ad data…" />}

      {data && !loading && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <Kpi label="Ad Spend" value={fmt.money(data.totals.spend, cur)} delta={delta(data.totals.spend, data.prevTotals.spend)} deltaGoodWhen="down" />
            <Kpi label="Ad Sales" value={fmt.money(data.totals.sales, cur)} delta={delta(data.totals.sales, data.prevTotals.sales)} />
            <Kpi label="Orders" value={fmt.int(data.totals.orders)} delta={delta(data.totals.orders, data.prevTotals.orders)} />
            <Kpi label="ACOS" value={fmt.pct(data.totals.acos)} delta={delta(data.totals.acos, data.prevTotals.acos)} deltaGoodWhen="down" />
            <Card className="min-w-0 px-4 py-3.5">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                <Flame className="size-3.5 text-critical" /> Wasted spend
              </div>
              <div className="tnum mt-1 break-words text-xl font-semibold leading-tight text-critical [overflow-wrap:anywhere]">
                {fmt.money(data.wasted.total, cur)}
              </div>
              <div className="mt-1 text-[12px] text-ink-3">days with spend but zero orders</div>
            </Card>
          </div>

          {data.wasted.top.length > 0 && (
            <Card className="mt-4 px-4 py-3">
              <div className="mb-2 text-xs font-semibold text-ink-2">Top wasted-spend targets in this period</div>
              <div className="flex flex-wrap gap-2">
                {data.wasted.top.map((w) => (
                  <Link
                    key={w.asin + w.campaign}
                    href={`/dashboard/asin/${encodeURIComponent(w.asin)}?country=${country}`}
                    className="group flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-xs transition hover:border-critical/40 hover:bg-critical/5"
                  >
                    <span className="font-mono font-semibold">{w.asin}</span>
                    <span className="max-w-48 truncate text-ink-3">{w.campaign}</span>
                    <span className="tnum font-semibold text-critical">{fmt.money(w.spend, cur)}</span>
                  </Link>
                ))}
              </div>
            </Card>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <MultiSelect options={data.asins} value={asinFilter} onChange={setAsinFilter} placeholder="ASIN" className="w-56" />
            <MultiSelect options={data.campaigns} value={campaignFilter} onChange={setCampaignFilter} placeholder="Campaign" className="w-64" />
            <span className="ml-auto text-xs text-ink-3">
              Filtered: <b className="tnum text-ink-2">{fmt.money(filteredTotals.spend, cur)}</b> spend ·{" "}
              <b className="tnum text-ink-2">{fmt.int(filteredTotals.orders)}</b> orders
            </span>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-ink-3">
            {LEGEND.map((l) => (
              <span key={l.label} className="inline-flex items-center gap-1.5">
                <span className="inline-block size-2 rounded-full" style={{ background: l.color }} />
                {l.label}
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block size-2 rounded-full bg-critical/30" /> logged in last 7 days
            </span>
          </div>

          {rows.length === 0 ? (
            <div className="mt-4"><EmptyState message="No data matches the current filters for the selected date range." /></div>
          ) : (
            <div className="glass mt-3 overflow-x-auto rounded-2xl">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-line">
                    <th className="sticky left-0 z-10 min-w-64 border-r border-line bg-surface px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-ink-3">
                      ASIN / Campaign
                    </th>
                    <th className="border-l border-grid px-3 py-2.5 text-right text-[11px] font-medium uppercase tracking-wider text-ink-3">ACOS</th>
                    {data.dates.map((d) => (
                      <th key={d} className="tnum whitespace-nowrap border-l border-grid px-2 py-2.5 text-center text-[11px] font-semibold text-ink-3">
                        {d.slice(5)}
                        <div className="flex justify-center gap-3 text-[10px] font-normal normal-case text-ink-3/80">
                          <span>Spend</span><span>Ord</span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 200).map((r) => (
                    <tr key={r.asin + r.campaign} className={clsx("group border-b border-grid last:border-b-0", r.logged && "bg-critical/6")}>
                      <td className="sticky left-0 z-10 max-w-80 border-r border-line bg-surface px-4 py-2">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-semibold">{r.asin}</span>
                          {r.logged && <Pill tone="critical">Logged</Pill>}
                          <span className="ml-auto inline-flex items-center gap-1 opacity-60 transition group-hover:opacity-100">
                            <Link
                              href={`/dashboard/asin/${encodeURIComponent(r.asin)}?country=${country}`}
                              className="rounded-md border border-line px-1.5 py-0.5 text-[10px] font-semibold text-ink-2 transition hover:border-accent/40 hover:text-accent"
                              title="ASIN details"
                            >
                              ASIN
                            </Link>
                            <Link
                              href={`/dashboard/campaign/${encodeURIComponent(r.campaign)}?country=${country}`}
                              className="rounded-md border border-line p-1 text-ink-2 transition hover:border-accent/40 hover:text-accent"
                              title="Campaign details"
                            >
                              <ExternalLink className="size-3" />
                            </Link>
                            <button
                              onClick={() => setLogTarget(r)}
                              className="rounded-md border border-line p-1 text-ink-2 transition hover:border-accent/40 hover:text-accent"
                              title="Log a change"
                            >
                              <PencilLine className="size-3" />
                            </button>
                          </span>
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-ink-3" title={r.campaign}>{r.campaign}</div>
                      </td>
                      <td className="tnum border-l border-grid px-3 py-2 text-right font-semibold">{r.acos > 0 ? fmt.pct(r.acos, 0) : "—"}</td>
                      {data.dates.map((d) => {
                        const day = r.days[d];
                        const st = day ? cellStyle(day.s, day.o) : null;
                        return (
                          <td key={d} className="whitespace-nowrap border-l border-grid px-1.5 py-2 text-center">
                            {day ? (
                              <span className="inline-flex items-center gap-1">
                                <span
                                  className="tnum inline-block min-w-12 rounded-md px-1 py-0.5 font-semibold"
                                  style={st ? { background: st.bg, color: st.fg } : undefined}
                                >
                                  {day.s.toFixed(0)}
                                </span>
                                <span className="tnum inline-block min-w-5 text-ink-2">{day.o}</span>
                              </span>
                            ) : (
                              <span className="text-ink-3/50">·</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 200 && (
                <div className="border-t border-line px-3 py-2 text-center text-[11px] text-ink-3">
                  Showing first 200 of {rows.length} pairs — narrow the filters to see the rest.
                </div>
              )}
            </div>
          )}
        </>
      )}

      <LogChangeDialog target={logTarget} onClose={() => setLogTarget(null)} onSaved={refresh} />
      <RecentLogsDialog open={showLogs} onClose={() => setShowLogs(false)} />
      <UploadDialog open={showUpload} onClose={() => setShowUpload(false)} country={country} onDone={refresh} />
    </div>
  );
}

/* ---------- dialogs ---------- */

function LogChangeDialog({ target, onClose, onSaved }: { target: PivotRow | null; onClose: () => void; onSaved: () => void }) {
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!target || !comment) return;
    setBusy(true);
    setErr(null);
    try {
      await postJson("/api/logs", { asin: target.asin, campaign: target.campaign, comment });
      setComment("");
      onClose();
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!target} onClose={onClose} title="Log a change">
      {target && (
        <div className="space-y-3">
          <p className="text-sm text-ink-2">
            <b className="font-mono">{target.asin}</b>
            <span className="mx-2 text-ink-3">·</span>
            {target.campaign}
          </p>
          <Field label="Comment / change description">
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-line bg-page px-3 py-2 text-[13px] outline-none ring-accent/30 focus:ring-2"
            />
          </Field>
          {err && <ErrorNote message={err} />}
          <Button onClick={submit} disabled={busy || !comment}>
            {busy ? "Saving…" : "Submit log"}
          </Button>
        </div>
      )}
    </Dialog>
  );
}

function RecentLogsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, loading } = useApi<{ logs: LogEntry[] }>(open ? "/api/logs?days=7" : null);
  return (
    <Dialog open={open} onClose={onClose} title="Recent change logs (last 7 days)" wide>
      {loading && <Spinner />}
      {data && data.logs.length === 0 && <EmptyState message="No logs in the last 7 days." />}
      {data && data.logs.length > 0 && (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-3">
              <th className="py-2 pr-3">When</th><th className="py-2 pr-3">ASIN</th>
              <th className="py-2 pr-3">Campaign</th><th className="py-2">Comment</th>
            </tr>
          </thead>
          <tbody>
            {data.logs.map((l, i) => (
              <tr key={i} className="border-b border-line last:border-b-0">
                <td className="tnum whitespace-nowrap py-2 pr-3 text-ink-3">{l.timestamp.slice(0, 16).replace("T", " ")}</td>
                <td className="py-2 pr-3 font-mono">{l.asin}</td>
                <td className="max-w-60 truncate py-2 pr-3" title={l.campaign}>{l.campaign}</td>
                <td className="py-2">{l.comment}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Dialog>
  );
}

function UploadDialog({ open, onClose, country, onDone }: { open: boolean; onClose: () => void; country: "IND" | "USA"; onDone: () => void }) {
  const { data: latest } = useApi<{ advLatest: string | null; ordersLatest: string | null; backend?: string }>(
    open ? `/api/ads/upload?country=${country}` : null,
  );
  const [adv, setAdv] = useState<File | null>(null);
  const [tgt, setTgt] = useState<File | null>(null);
  const [orders, setOrders] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const nextDay = (d: string | null) =>
    d ? new Date(Date.parse(d) + 86400000).toISOString().slice(0, 10) : "your earliest available date";

  /** Parse xlsx in the browser and stream typed rows in chunks — the raw files
      can exceed Vercel's ~4.5 MB request limit, small JSON chunks never do. */
  async function submitChunked() {
    const { parseReportFile, toAdRows, toTargetingRows, toOrderRows, UPLOAD_CHUNK } = await import("@/lib/ads-upload");
    const results: Record<string, number> = {};
    const jobs: { kind: "adv" | "tgt" | "orders"; label: string; file: File; normalize: (r: Awaited<ReturnType<typeof parseReportFile>>) => { date: string }[] }[] = [
      { kind: "adv", label: "Advertised Product", file: adv!, normalize: toAdRows },
      { kind: "tgt", label: "Targeting", file: tgt!, normalize: toTargetingRows },
      ...(orders && country === "IND" ? [{ kind: "orders" as const, label: "Orders", file: orders, normalize: toOrderRows }] : []),
    ];
    for (const job of jobs) {
      setProgress(`Reading ${job.label} report…`);
      const rows = job.normalize(await parseReportFile(job.file));
      let sent = 0;
      for (let i = 0; i < rows.length; i += UPLOAD_CHUNK) {
        setProgress(`Uploading ${job.label}: ${Math.min(i + UPLOAD_CHUNK, rows.length).toLocaleString()} / ${rows.length.toLocaleString()} rows…`);
        const res = await postJson<{ inserted: number }>("/api/ads/upload", { country, kind: job.kind, rows: rows.slice(i, i + UPLOAD_CHUNK) });
        sent += res.inserted;
      }
      results[job.label] = sent;
    }
    return results;
  }

  async function submit() {
    if (!adv || !tgt) { setErr("Please attach both the Advertised Product and Targeting reports."); return; }
    setBusy(true); setErr(null); setDone(null);
    try {
      let results: Record<string, number>;
      if (latest?.backend === "db") {
        results = await submitChunked();
      } else {
        const form = new FormData();
        form.set("country", country);
        form.set("adv", adv);
        form.set("tgt", tgt);
        if (orders) form.set("orders", orders);
        const res = await postForm<{ appended: Record<string, number> }>("/api/ads/upload", form);
        results = res.appended;
      }
      setDone(Object.entries(results).map(([k, v]) => `${k}: +${v} rows`).join(" · "));
      setAdv(null); setTgt(null); setOrders(null);
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={`Upload reports — ${country === "IND" ? "India" : "USA"}`}>
      <div className="space-y-4 text-[13px]">
        <div className="rounded-lg bg-accent/8 px-3 py-2 text-ink-2">
          Latest <b>Advertised Product</b> data: <b className="tnum">{latest?.advLatest ?? "none yet"}</b>.
          Export the report from <b className="tnum">{nextDay(latest?.advLatest ?? null)}</b> to yesterday.
        </div>
        <Field label="Advertised Product report (.xlsx) — Amazon Ads → Measurement & Reporting → Sponsored Products → Advertised Product, Daily">
          <input type="file" accept=".xlsx" onChange={(e) => setAdv(e.target.files?.[0] ?? null)} className={inputCls + " py-1.5"} />
        </Field>
        <Field label="Targeting report (.xlsx) — same path, Report Type: Targeting, Daily">
          <input type="file" accept=".xlsx" onChange={(e) => setTgt(e.target.files?.[0] ?? null)} className={inputCls + " py-1.5"} />
        </Field>
        {country === "IND" && (
          <>
            <div className="rounded-lg bg-accent/8 px-3 py-2 text-ink-2">
              Latest <b>Orders</b> data: <b className="tnum">{latest?.ordersLatest ?? "none yet"}</b>.
              Seller Central → Reports → Fulfillment → Sales → All Orders.
            </div>
            <Field label="Orders report (.xlsx / .csv) — optional, for organic-sales insights">
              <input type="file" accept=".xlsx,.csv" onChange={(e) => setOrders(e.target.files?.[0] ?? null)} className={inputCls + " py-1.5"} />
            </Field>
          </>
        )}
        {err && <ErrorNote message={err} />}
        {done && <div className="rounded-lg bg-good/10 px-3 py-2 text-sm text-[var(--delta-good)]">Appended — {done}</div>}
        {busy && progress && <div className="tnum text-xs text-ink-3">{progress}</div>}
        <Button onClick={submit} disabled={busy}>{busy ? "Uploading…" : "Process & append"}</Button>
      </div>
    </Dialog>
  );
}
