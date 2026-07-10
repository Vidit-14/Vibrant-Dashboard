"use client";
import { useMemo, useState } from "react";
import { useApi, fmt, postForm } from "@/lib/client";
import { Button, Card, Dialog, EmptyState, ErrorNote, Field, PageHeader, Pill, Spinner, inputCls } from "@/components/ui";
import { TrendChart } from "@/components/charts";
import DataTable from "@/components/DataTable";
import { type ColumnDef } from "@tanstack/react-table";
import { Upload, ArrowUpRight, ArrowDownRight } from "lucide-react";
import clsx from "clsx";

interface VocRow {
  snapshotDate: string; productName: string; asin: string; sku: string;
  ncxRate: string; ncxOrders: string; totalOrders: string; starRating: string;
  returnRate: string; topReason: string; status: string;
}
interface VocData {
  latest: string | null;
  prev: string | null;
  current: VocRow[];
  changes: { asin: string; from: string; to: string; direction: string }[];
  missing: string[];
  trend: Record<string, string | number>[];
  statusOrder: string[];
}

/** Validated diverging scale (red ↔ blue, neutral mid) — labels always accompany color. */
const STATUS_COLOR: Record<string, string> = {
  "Very poor": "var(--voc-1)",
  Poor: "var(--voc-2)",
  Fair: "var(--voc-3)",
  Good: "var(--voc-4)",
  Excellent: "var(--voc-5)",
};

export default function VocPage() {
  const { data, error, loading, refresh } = useApi<VocData>("/api/voc");
  const [filter, setFilter] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of data?.statusOrder ?? []) c[s] = 0;
    for (const r of data?.current ?? []) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [data]);

  const shown = useMemo(
    () => (data?.current ?? []).filter((r) => !filter || r.status === filter),
    [data, filter],
  );

  const columns: ColumnDef<VocRow, unknown>[] = [
    { header: "Product", accessorKey: "productName",
      cell: (c) => <span className="block max-w-72 truncate" title={String(c.getValue())}>{String(c.getValue())}</span> },
    { header: "ASIN", accessorKey: "asin", cell: (c) => <span className="font-mono">{String(c.getValue())}</span> },
    { header: "SKU", accessorKey: "sku", cell: (c) => <span className="block max-w-40 truncate">{String(c.getValue())}</span> },
    { header: "Status", accessorKey: "status",
      cell: (c) => (
        <Pill style={{ background: STATUS_COLOR[String(c.getValue())] ?? "var(--voc-3)", color: "#fff" }}>
          {String(c.getValue())}
        </Pill>
      ) },
    { header: "NCX rate", accessorKey: "ncxRate", cell: (c) => <span className="tnum">{String(c.getValue())}</span> },
    { header: "NCX orders", accessorKey: "ncxOrders", cell: (c) => <span className="tnum">{String(c.getValue())}</span> },
    { header: "Orders", accessorKey: "totalOrders", cell: (c) => <span className="tnum">{String(c.getValue())}</span> },
    { header: "Stars", accessorKey: "starRating", cell: (c) => <span className="tnum">{String(c.getValue())}</span> },
    { header: "Return rate", accessorKey: "returnRate", cell: (c) => <span className="tnum">{String(c.getValue())}</span> },
    { header: "Top NCX reason", accessorKey: "topReason",
      cell: (c) => <span className="block max-w-56 truncate" title={String(c.getValue())}>{String(c.getValue())}</span> },
  ];

  return (
    <div>
      <PageHeader
        title="Voice of the Customer"
        subtitle={data?.latest ? `Latest snapshot: ${data.latest}${data.prev ? ` · compared with ${data.prev}` : ""}` : "CX health of your listings"}
      >
        <Button onClick={() => setShowUpload(true)}>
          <Upload className="size-4" /> Upload report
        </Button>
      </PageHeader>

      {error && <ErrorNote message={error} />}
      {loading && <Spinner label="Loading snapshots…" />}
      {data && !loading && data.current.length === 0 && (
        <EmptyState message="No snapshots yet. Upload your first Voice of the Customer report to begin." />
      )}

      {data && !loading && data.current.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {data.statusOrder.map((s) => (
              <button
                key={s}
                onClick={() => setFilter(filter === s ? null : s)}
                className={clsx(
                  "glass rounded-2xl p-4 text-left transition hover:!border-accent/40",
                  filter === s && "!border-accent ring-2 ring-accent/20",
                )}
              >
                <span
                  className="inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold text-white"
                  style={{ background: STATUS_COLOR[s] }}
                >
                  {s}
                </span>
                <div className="tnum mt-2 text-3xl font-semibold">{counts[s] ?? 0}</div>
                <div className="mt-0.5 text-[11px] text-ink-3">{filter === s ? "click to clear filter" : "listings"}</div>
              </button>
            ))}
          </div>

          {(data.changes.length > 0 || data.missing.length > 0) && (
            <Card className="mt-4 p-4">
              <h2 className="text-sm font-semibold">
                Changes since {data.prev}: {data.changes.length} status change(s), {data.missing.length} missing from latest file
              </h2>
              {data.changes.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {data.changes.map((c) => (
                    <span key={c.asin} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs">
                      {c.direction === "Improved"
                        ? <ArrowUpRight className="size-3.5 text-[var(--delta-good)]" />
                        : <ArrowDownRight className="size-3.5 text-critical" />}
                      <span className="font-mono font-semibold">{c.asin}</span>
                      <span className="text-ink-3">{c.from} → <b className="text-ink">{c.to}</b></span>
                    </span>
                  ))}
                </div>
              )}
              {data.missing.length > 0 && (
                <p className="mt-3 text-xs text-ink-3">
                  <b className="text-ink-2">Missing from latest snapshot:</b> {data.missing.join(", ")}
                </p>
              )}
            </Card>
          )}

          {data.trend.length >= 2 && (
            <Card className="mt-4 p-4">
              <h2 className="mb-2 text-sm font-semibold">Listing health over time</h2>
              <TrendChart
                data={data.trend}
                x="date"
                height={260}
                series={data.statusOrder.map((s) => ({ key: s, label: s, color: STATUS_COLOR[s] }))}
              />
            </Card>
          )}

          <Card className="mt-4 p-4">
            <h2 className="mb-3 text-sm font-semibold">
              {filter ? `${filter} listings (${fmt.int(shown.length)})` : `All listings (${fmt.int(shown.length)})`}
            </h2>
            <DataTable data={shown} columns={columns} exportName="voc-snapshot" dense pageSize={15} />
          </Card>
        </>
      )}

      <UploadDialog open={showUpload} onClose={() => setShowUpload(false)} onDone={refresh} />
    </div>
  );
}

function UploadDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit() {
    if (!file) { setErr("Please attach the report."); return; }
    setBusy(true); setErr(null); setDone(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("date", date);
      const res = await postForm<{ rows: number }>("/api/voc/upload", form);
      setDone(`Snapshot saved — ${res.rows} unique ASINs.`);
      setFile(null);
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Upload Voice of the Customer report">
      <div className="space-y-4 text-[13px]">
        <p className="text-ink-2">Seller Central → Performance → Voice of the Customer → Download data.</p>
        <Field label="Snapshot date">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Report file (.csv / .xlsx)">
          <input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className={inputCls + " py-1.5"} />
        </Field>
        {err && <ErrorNote message={err} />}
        {done && <div className="rounded-lg bg-good/10 px-3 py-2 text-[var(--delta-good)]">{done}</div>}
        <Button onClick={submit} disabled={busy}>{busy ? "Saving…" : "Submit"}</Button>
      </div>
    </Dialog>
  );
}
