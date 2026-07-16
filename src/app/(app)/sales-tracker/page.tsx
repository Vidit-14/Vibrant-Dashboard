"use client";
import { useMemo, useState } from "react";
import { useApi, fmt, postForm, downloadCsv } from "@/lib/client";
import { Button, Card, Dialog, EmptyState, ErrorNote, Field, PageHeader, Spinner, inputCls } from "@/components/ui";
import { TrendChart, SERIES } from "@/components/charts";
import { Download, Upload } from "lucide-react";
import clsx from "clsx";

interface TrackerRow { asin: string; title: string; avg: number; days: Record<string, number>; total: number }
interface TrackerData { baselineMonth: string; missingBaseline: boolean; dates: string[]; rows: TrackerRow[] }

function monthOptions(): { key: string; label: string }[] {
  const out = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
    });
  }
  return out;
}

export default function SalesTrackerPage() {
  const months = useMemo(monthOptions, []);
  const [month, setMonth] = useState(months[0].key);
  const [upload, setUpload] = useState<"monthly" | "daily" | null>(null);

  const { data, error, loading, refresh } = useApi<TrackerData>(`/api/sales-tracker?month=${month}`);

  const dayTotals = useMemo(() => {
    if (!data) return [];
    const baselineTotal = data.rows.reduce((s, r) => s + r.avg, 0);
    return data.dates.map((d) => ({
      date: d.slice(8),
      units: data.rows.reduce((s, r) => s + (r.days[d] ?? 0), 0),
      baseline: +baselineTotal.toFixed(1),
    }));
  }, [data]);

  function exportCsv() {
    if (!data) return;
    downloadCsv(
      `daily-sales-tracker-${month}.csv`,
      ["ASIN", "Title", `Avg/day (${data.baselineMonth})`, "Total", ...data.dates],
      data.rows.map((r) => [r.asin, r.title, +r.avg.toFixed(1), r.total, ...data.dates.map((d) => r.days[d] ?? 0)]),
    );
  }

  return (
    <div>
      <PageHeader title="Daily Sales Tracker" subtitle="Daily units vs last month's average — top 30 ASINs">
        <select value={month} onChange={(e) => setMonth(e.target.value)} className="glass h-9 rounded-xl px-3 text-[13px] font-medium">
          {months.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
        <Button variant="ghost" onClick={() => setUpload("monthly")}>
          <Upload className="size-4" /> Monthly report
        </Button>
        <Button onClick={() => setUpload("daily")}>
          <Upload className="size-4" /> Daily report
        </Button>
      </PageHeader>

      {error && <ErrorNote message={error} />}
      {loading && <Spinner label="Building comparison…" />}

      {data && !loading && data.missingBaseline && (
        <EmptyState message={`No baseline data for ${data.baselineMonth}. Upload that month's full Business Report first (Seller Central → Reports → Business Reports → By ASIN → Detail Page Sales and Traffic).`} />
      )}

      {data && !loading && !data.missingBaseline && (
        <>
          {data.dates.length === 0 ? (
            <EmptyState message={`No daily reports uploaded for ${month} yet. Upload yesterday's Business Report to start tracking.`} />
          ) : (
            <>
              <Card className="p-4">
                <h2 className="mb-2 text-sm font-semibold">Total daily units vs baseline</h2>
                <TrendChart
                  data={dayTotals}
                  x="date"
                  height={220}
                  series={[
                    { key: "units", label: "Units ordered", color: SERIES[0] },
                    { key: "baseline", label: `Avg (${data.baselineMonth})`, color: SERIES[2] },
                  ]}
                />
              </Card>

              <div className="mt-4 flex flex-wrap items-center gap-4 text-[11px] text-ink-3">
                <span className="font-semibold uppercase tracking-wider">Cell legend</span>
                <span className="inline-flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm bg-good/25" /> above monthly average</span>
                <span className="inline-flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm bg-critical/20" /> at or below average</span>
                <span className="inline-flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm border border-line" /> zero</span>
                <button
                  onClick={exportCsv}
                  className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-xs font-semibold text-ink-2 transition hover:bg-ink/5"
                >
                  <Download className="size-3.5" /> CSV
                </button>
              </div>

              <div className="glass mt-2 overflow-x-auto rounded-2xl">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-line">
                      <th className="sticky left-0 z-10 min-w-56 border-r border-line bg-surface px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-ink-3">ASIN / Title</th>
                      <th className="border-l border-grid px-2 py-2.5 text-right text-[11px] font-medium uppercase tracking-wider text-ink-3">Avg/day</th>
                      <th className="border-l border-grid px-2 py-2.5 text-right text-[11px] font-medium uppercase tracking-wider text-ink-3">Total</th>
                      {data.dates.map((d) => (
                        <th key={d} className="tnum border-l border-grid px-2 py-2.5 text-center text-[11px] font-semibold text-ink-3">{d.slice(8)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r.asin} className="border-b border-grid last:border-b-0">
                        <td className="sticky left-0 z-10 max-w-72 border-r border-line bg-surface px-4 py-1.5">
                          <div className="font-mono font-semibold">{r.asin}</div>
                          <div className="truncate text-[11px] text-ink-3" title={r.title}>{r.title}</div>
                        </td>
                        <td className="tnum border-l border-grid px-2 py-1.5 text-right font-semibold">{r.avg.toFixed(1)}</td>
                        <td className="tnum border-l border-grid px-2 py-1.5 text-right font-semibold">{fmt.int(r.total)}</td>
                        {data.dates.map((d) => {
                          const v = r.days[d] ?? 0;
                          return (
                            <td
                              key={d}
                              className={clsx(
                                "tnum border-l border-grid px-2 py-1.5 text-center",
                                v === 0 ? "text-ink-3/60" : v > r.avg ? "bg-good/15 font-semibold" : "bg-critical/10",
                              )}
                            >
                              {v === 0 ? "·" : v}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      <UploadDialog kind={upload} onClose={() => setUpload(null)} onDone={refresh} months={months} />
    </div>
  );
}

function UploadDialog({
  kind, onClose, onDone, months,
}: {
  kind: "monthly" | "daily" | null;
  onClose: () => void;
  onDone: () => void;
  months: { key: string; label: string }[];
}) {
  const yesterday = useMemo(() => {
    const d = new Date(Date.now() - 86400000);
    return d.toISOString().slice(0, 10);
  }, []);
  const [month, setMonth] = useState(months[1]?.key ?? months[0].key);
  const [date, setDate] = useState(yesterday);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit() {
    if (!file || !kind) { setErr("Please attach the report."); return; }
    setBusy(true); setErr(null); setDone(null);
    try {
      const form = new FormData();
      form.set("kind", kind);
      form.set("file", file);
      if (kind === "monthly") form.set("month", month);
      else form.set("date", date);
      const res = await postForm<{ rows: number }>("/api/sales-tracker/upload", form);
      setDone(`Saved ${res.rows} rows.`);
      setFile(null);
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!kind} onClose={onClose} title={kind === "monthly" ? "Upload monthly Business Report" : "Upload daily Business Report"}>
      <div className="space-y-4 text-[13px]">
        <p className="text-ink-2">
          Seller Central → Reports → Business Reports → By ASIN → Detail Page Sales and Traffic
          {kind === "monthly" ? " — full previous month. Sets the daily baseline (top-30 ASIN daily averages)." : " — a single day (usually yesterday). Replaces any existing upload for that date."}
        </p>
        {kind === "monthly" ? (
          <Field label="Month">
            <select value={month} onChange={(e) => setMonth(e.target.value)} className={inputCls}>
              {months.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </Field>
        ) : (
          <Field label="Report date">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </Field>
        )}
        <Field label="Business Report (.csv)">
          <input type="file" accept=".csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className={inputCls + " py-1.5"} />
        </Field>
        {err && <ErrorNote message={err} />}
        {done && <div className="rounded-lg bg-good/10 px-3 py-2 text-[var(--delta-good)]">{done}</div>}
        <Button onClick={submit} disabled={busy}>{busy ? "Processing…" : "Submit"}</Button>
      </div>
    </Dialog>
  );
}
