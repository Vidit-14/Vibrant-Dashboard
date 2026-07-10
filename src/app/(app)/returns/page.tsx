"use client";
import { useMemo, useState } from "react";
import { useApi, fmt, postForm } from "@/lib/client";
import { type Range, DateRangePicker } from "@/components/filters";
import { Button, Card, Dialog, EmptyState, ErrorNote, Field, Kpi, PageHeader, Pill, Spinner, inputCls } from "@/components/ui";
import { TrendChart, BarsChart, SERIES } from "@/components/charts";
import DataTable from "@/components/DataTable";
import { type ColumnDef } from "@tanstack/react-table";
import { Upload, MapPin, TrendingUp, ShieldQuestion } from "lucide-react";

interface CombinedRow {
  date: string; orderId: string; asin: string; disposition: string;
  reason: string; comments: string; buyerEmail: string; title: string; pincode: string;
}

const EXCLUDED_REASONS = ["UNDELIVERABLE_REFUSED", "UNDELIVERABLE_UNKNOWN"];

export default function ReturnsPage() {
  const { data, error, loading, refresh } = useApi<{ rows: CombinedRow[] }>("/api/returns");
  const [range, setRange] = useState<Range | null>(null);
  const [showUpload, setShowUpload] = useState(false);

  const fullRange = useMemo<Range | null>(() => {
    if (!data?.rows.length) return null;
    const dates = data.rows.map((r) => r.date).sort();
    return { start: dates[0], end: dates[dates.length - 1] };
  }, [data]);

  const effective = range ?? fullRange;
  const rows = useMemo(() => {
    if (!data) return [];
    if (!effective) return data.rows;
    return data.rows.filter((r) => r.date >= effective.start && r.date <= effective.end);
  }, [data, effective]);

  /* ---- analytics ---- */
  const uniqueReturns = useMemo(() => new Set(rows.map((r) => r.orderId)).size, [rows]);

  const topAsins = useMemo(() => {
    const counts = new Map<string, { count: number; title: string }>();
    for (const r of rows) {
      const e = counts.get(r.asin) ?? { count: 0, title: r.title };
      e.count += 1;
      if (!e.title && r.title) e.title = r.title;
      counts.set(r.asin, e);
    }
    return [...counts.entries()].map(([asin, v]) => ({ asin, ...v })).sort((a, b) => b.count - a.count).slice(0, 3);
  }, [rows]);

  const topForReason = useMemo(() => {
    const calc = (reason: string) => {
      const counts = new Map<string, number>();
      for (const r of rows) if (r.reason.toUpperCase() === reason) counts.set(r.asin, (counts.get(r.asin) ?? 0) + 1);
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      return top ? `${top[0]} (${top[1]})` : "N/A";
    };
    return { defective: calc("DEFECTIVE"), notAsDescribed: calc("NOT_AS_DESCRIBED") };
  }, [rows]);

  const trendData = useMemo(() => {
    const byDate = new Map<string, number>();
    for (const r of rows) byDate.set(r.date, (byDate.get(r.date) ?? 0) + 1);
    return [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, count]) => ({ date, count }));
  }, [rows]);

  const reasonData = useMemo(() => {
    const byReason = new Map<string, number>();
    for (const r of rows) {
      if (!r.reason || EXCLUDED_REASONS.includes(r.reason.toUpperCase())) continue;
      byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + 1);
    }
    return [...byReason.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([reason, count]) => ({ reason, count }));
  }, [rows]);

  const clusters = useMemo(() => {
    const byPin = new Map<string, number>();
    for (const r of rows) if (r.pincode) byPin.set(r.pincode, (byPin.get(r.pincode) ?? 0) + 1);
    const frequent = new Set([...byPin.entries()].filter(([, c]) => c >= 2).map(([p]) => p));
    return rows.filter((r) => frequent.has(r.pincode)).sort((a, b) => a.pincode.localeCompare(b.pincode) || a.date.localeCompare(b.date));
  }, [rows]);

  const spikes = useMemo(() => {
    const byAsinMonth = new Map<string, Set<string>>();
    for (const r of rows) {
      const key = `${r.asin}||${r.date.slice(0, 7)}`;
      (byAsinMonth.get(key) ?? byAsinMonth.set(key, new Set()).get(key)!).add(r.orderId);
    }
    return [...byAsinMonth.entries()]
      .filter(([, orders]) => orders.size > 5)
      .map(([key, orders]) => {
        const [asin, month] = key.split("||");
        return { asin, month, count: orders.size };
      })
      .sort((a, b) => b.count - a.count);
  }, [rows]);

  const suspicious = useMemo(
    () => rows.filter((r) => r.reason.toUpperCase() !== "UNDELIVERABLE_REFUSED" && r.disposition === "SELLABLE"),
    [rows],
  );

  const clusterCols: ColumnDef<CombinedRow, unknown>[] = [
    { header: "Date", accessorKey: "date", cell: (c) => <span className="tnum">{String(c.getValue())}</span> },
    { header: "Pincode", accessorKey: "pincode", cell: (c) => <span className="tnum font-semibold">{String(c.getValue())}</span> },
    { header: "Order", accessorKey: "orderId", cell: (c) => <span className="font-mono text-xs">{String(c.getValue())}</span> },
    { header: "ASIN", accessorKey: "asin", cell: (c) => <span className="font-mono">{String(c.getValue())}</span> },
    { header: "Reason", accessorKey: "reason", cell: (c) => <Pill tone="neutral">{String(c.getValue())}</Pill> },
  ];

  const suspiciousCols: ColumnDef<CombinedRow, unknown>[] = [
    { header: "Date", accessorKey: "date", cell: (c) => <span className="tnum">{String(c.getValue())}</span> },
    { header: "Order", accessorKey: "orderId", cell: (c) => <span className="font-mono text-xs">{String(c.getValue())}</span> },
    { header: "ASIN", accessorKey: "asin", cell: (c) => <span className="font-mono">{String(c.getValue())}</span> },
    { header: "Title", accessorKey: "title", cell: (c) => <span className="block max-w-72 truncate" title={String(c.getValue())}>{String(c.getValue())}</span> },
    { header: "Reason", accessorKey: "reason", cell: (c) => <Pill tone="warning">{String(c.getValue())}</Pill> },
    { header: "Customer comment", accessorKey: "comments", cell: (c) => <span className="block max-w-96 truncate" title={String(c.getValue())}>{String(c.getValue())}</span> },
  ];

  const allCols: ColumnDef<CombinedRow, unknown>[] = [
    ...clusterCols.slice(0, 4),
    { header: "Disposition", accessorKey: "disposition" },
    { header: "Reason", accessorKey: "reason" },
    { header: "Title", accessorKey: "title", cell: (c) => <span className="block max-w-72 truncate" title={String(c.getValue())}>{String(c.getValue())}</span> },
  ];

  return (
    <div>
      <PageHeader title="Return Fraud Analysis" subtitle="FBA returns joined with fulfilled sales">
        {effective && <DateRangePicker value={effective} onChange={setRange} />}
        <Button onClick={() => setShowUpload(true)}>
          <Upload className="size-4" /> Upload reports
        </Button>
      </PageHeader>

      {error && <ErrorNote message={error} />}
      {loading && <Spinner label="Loading returns data…" />}
      {data && !loading && data.rows.length === 0 && (
        <EmptyState message="No data available. Upload the FBA Returns and Fulfilled Sales reports to begin." />
      )}

      {data && !loading && data.rows.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Kpi label="Unique returns" value={fmt.int(uniqueReturns)} hint="in selected range" />
            <Kpi label="Most DEFECTIVE returns" value={topForReason.defective} hint="ASIN (count)" />
            <Kpi label="Most NOT_AS_DESCRIBED" value={topForReason.notAsDescribed} hint="ASIN (count)" />
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            {topAsins.map((t, i) => (
              <Card key={t.asin} className="px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">#{i + 1} most returned</div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="font-mono text-sm font-semibold">{t.asin}</span>
                  <span className="tnum text-lg font-semibold text-critical">{t.count}</span>
                  <span className="text-xs text-ink-3">returns</span>
                </div>
                <div className="mt-0.5 truncate text-xs text-ink-3" title={t.title}>{t.title || "No title"}</div>
              </Card>
            ))}
          </div>

          <div className="mt-5 grid gap-4 xl:grid-cols-2">
            <Card className="p-4">
              <h2 className="mb-2 text-sm font-semibold">Returns over time</h2>
              <TrendChart data={trendData} x="date" series={[{ key: "count", label: "Returns", color: SERIES[0] }]} height={230} />
            </Card>
            <Card className="p-4">
              <h2 className="mb-2 text-sm font-semibold">Returns by reason (top 10)</h2>
              <BarsChart data={reasonData} x="reason" y="count" label="Returns" height={230} />
            </Card>
          </div>

          <Card className="mt-5 p-4">
            <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
              <MapPin className="size-4 text-ink-3" /> Geographic return clusters
            </h2>
            <p className="mb-3 text-xs text-ink-3">Returns from pincodes with 2 or more returns — repeated returns from one area can indicate abuse.</p>
            {clusters.length === 0
              ? <EmptyState message="No pincodes with 2 or more returns found." />
              : <DataTable data={clusters} columns={clusterCols} exportName="return-clusters" dense pageSize={10} />}
          </Card>

          <Card className="mt-5 p-4">
            <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
              <TrendingUp className="size-4 text-ink-3" /> ASIN return-rate spikes
            </h2>
            <p className="mb-3 text-xs text-ink-3">ASINs with more than 5 unique returns in a single month.</p>
            {spikes.length === 0
              ? <EmptyState message="No spikes found." />
              : (
                <DataTable
                  data={spikes}
                  columns={[
                    { header: "ASIN", accessorKey: "asin", cell: (c) => <span className="font-mono">{String(c.getValue())}</span> },
                    { header: "Month", accessorKey: "month", cell: (c) => <span className="tnum">{String(c.getValue())}</span> },
                    { header: "Unique returns", accessorKey: "count", cell: (c) => <span className="tnum font-semibold text-critical">{String(c.getValue())}</span> },
                  ] as ColumnDef<(typeof spikes)[number], unknown>[]}
                  exportName="return-spikes"
                  dense
                  pageSize={10}
                />
              )}
          </Card>

          <Card className="mt-5 p-4">
            <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
              <ShieldQuestion className="size-4 text-ink-3" /> Suspicious returns (SELLABLE disposition)
            </h2>
            <p className="mb-3 text-xs text-ink-3">Item came back sellable but the buyer claimed a problem — possible fraud or wardrobing.</p>
            {suspicious.length === 0
              ? <EmptyState message="Nothing suspicious in this range." />
              : <DataTable data={suspicious} columns={suspiciousCols} exportName="suspicious-returns" dense pageSize={10} />}
          </Card>

          <Card className="mt-5 p-4">
            <h2 className="mb-3 text-sm font-semibold">Combined data ({fmt.int(rows.length)} rows)</h2>
            <DataTable data={rows} columns={allCols} exportName="returns-combined" dense pageSize={15} />
          </Card>
        </>
      )}

      <UploadDialog open={showUpload} onClose={() => setShowUpload(false)} onDone={refresh} />
    </div>
  );
}

function UploadDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [returnsFile, setReturnsFile] = useState<File | null>(null);
  const [salesFile, setSalesFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit() {
    if (!returnsFile || !salesFile) { setErr("Please attach both files."); return; }
    setBusy(true); setErr(null); setDone(null);
    try {
      const form = new FormData();
      form.set("returns", returnsFile);
      form.set("sales", salesFile);
      const res = await postForm<{ returns: number; sales: number }>("/api/returns/upload", form);
      setDone(`Processed ${res.returns} return rows and ${res.sales} sales rows. Combined data regenerated.`);
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Upload Amazon reports">
      <div className="space-y-4 text-[13px]">
        <Field label="FBA Returns report (.csv/.txt) — Seller Central → Reports → Fulfillment → Customer Concessions → FBA customer returns">
          <input type="file" accept=".csv,.txt" onChange={(e) => setReturnsFile(e.target.files?.[0] ?? null)} className={inputCls + " py-1.5"} />
        </Field>
        <Field label="Amazon Fulfilled Sales report (.csv/.txt) — Seller Central → Reports → Fulfillment → Sales → Amazon fulfilled shipments">
          <input type="file" accept=".csv,.txt" onChange={(e) => setSalesFile(e.target.files?.[0] ?? null)} className={inputCls + " py-1.5"} />
        </Field>
        <p className="text-xs text-ink-3">New rows are de-duplicated against existing data on Order Id, then the combined report is regenerated.</p>
        {err && <ErrorNote message={err} />}
        {done && <div className="rounded-lg bg-good/10 px-3 py-2 text-[var(--delta-good)]">{done}</div>}
        <Button onClick={submit} disabled={busy}>{busy ? "Processing…" : "Submit"}</Button>
      </div>
    </Dialog>
  );
}
