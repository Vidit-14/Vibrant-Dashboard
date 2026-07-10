"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useApi, fmt, postForm } from "@/lib/client";
import { MultiSelect } from "@/components/filters";
import { Button, Card, Dialog, EmptyState, ErrorNote, Field, Kpi, PageHeader, Pill, Spinner, inputCls } from "@/components/ui";
import DataTable from "@/components/DataTable";
import { type ColumnDef } from "@tanstack/react-table";
import { Upload } from "lucide-react";

interface HealthRow {
  asin: string; title: string; sales: number; units: number; sessions: number;
  usp: number; buyBox: number; asp: number;
  trafficFlag: string; conversionFlag: string; buyBoxFlag: string; opportunity: string;
  potentialUnits: number; potentialRevenue: number; priorityScore: number;
}
interface HealthData { availableMonths: string[]; months: string[]; rows: HealthRow[] }

function flagPill(value: string) {
  if (value === "OK") return <Pill tone="good">OK</Pill>;
  return <Pill tone="critical">{value}</Pill>;
}

export default function AsinHealthPage() {
  const [months, setMonths] = useState<string[]>([]);
  const [targetUsp, setTargetUsp] = useState(0.08);
  const [showUpload, setShowUpload] = useState(false);

  const monthsParam = months.join(",");
  const { data, error, loading, refresh } = useApi<HealthData>(
    `/api/health?targetUsp=${targetUsp}${monthsParam ? `&months=${monthsParam}` : ""}`,
  );
  const effectiveMonths = months.length ? months : data?.months ?? [];
  const latestMonth = useMemo(() => [...effectiveMonths].sort().pop() ?? "", [effectiveMonths]);

  const kpis = useMemo(() => {
    const rows = data?.rows ?? [];
    const sales = rows.reduce((s, r) => s + r.sales, 0);
    const units = rows.reduce((s, r) => s + r.units, 0);
    const sessions = rows.reduce((s, r) => s + r.sessions, 0);
    const wUsp = sessions > 0 ? rows.reduce((s, r) => s + r.usp * r.sessions, 0) / sessions : 0;
    const wBb = sessions > 0 ? rows.reduce((s, r) => s + r.buyBox * r.sessions, 0) / sessions : 0;
    return { sales, units, sessions, wUsp, wBb };
  }, [data]);

  const columns: ColumnDef<HealthRow, unknown>[] = [
    { header: "ASIN", accessorKey: "asin",
      cell: (c) => (
        <Link
          href={`/asin-health/${encodeURIComponent(String(c.getValue()))}?month=${latestMonth}&targetUsp=${targetUsp}`}
          className="font-mono font-semibold text-accent hover:underline"
        >
          {String(c.getValue())}
        </Link>
      ) },
    { header: "Title", accessorKey: "title",
      cell: (c) => <span className="block max-w-64 truncate" title={String(c.getValue())}>{String(c.getValue())}</span> },
    { header: "Sales", accessorKey: "sales", cell: (c) => <span className="tnum">{fmt.money(c.getValue() as number)}</span> },
    { header: "Units", accessorKey: "units", cell: (c) => <span className="tnum">{fmt.int(c.getValue() as number)}</span> },
    { header: "Sessions", accessorKey: "sessions", cell: (c) => <span className="tnum">{fmt.int(c.getValue() as number)}</span> },
    { header: "USP", accessorKey: "usp", cell: (c) => <span className="tnum">{(c.getValue() as number).toFixed(4)}</span> },
    { header: "Buy Box", accessorKey: "buyBox", cell: (c) => <span className="tnum">{(c.getValue() as number).toFixed(3)}</span> },
    { header: "ASP", accessorKey: "asp", cell: (c) => <span className="tnum">{fmt.money(c.getValue() as number)}</span> },
    { header: "Traffic", accessorKey: "trafficFlag", cell: (c) => flagPill(String(c.getValue())) },
    { header: "Conversion", accessorKey: "conversionFlag", cell: (c) => flagPill(String(c.getValue())) },
    { header: "Buy Box Flag", accessorKey: "buyBoxFlag", cell: (c) => flagPill(String(c.getValue())) },
    { header: "Opportunity", accessorKey: "opportunity",
      cell: (c) => (c.getValue() ? <Pill tone="warning">{String(c.getValue())}</Pill> : <span className="text-ink-3">—</span>) },
    { header: "Potential Rev.", accessorKey: "potentialRevenue", cell: (c) => <span className="tnum">{fmt.money(c.getValue() as number)}</span> },
    { header: "Priority", accessorKey: "priorityScore", cell: (c) => <span className="tnum font-semibold">{fmt.int(c.getValue() as number)}</span> },
  ];

  return (
    <div>
      <PageHeader title="ASIN Health" subtitle="Traffic, conversion & Buy Box diagnostics with prioritised opportunities">
        <Button onClick={() => setShowUpload(true)}>
          <Upload className="size-4" /> Upload monthly report
        </Button>
      </PageHeader>

      {error && <ErrorNote message={error} />}
      {loading && <Spinner label="Crunching health metrics…" />}

      {data && !loading && (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Months to analyse" className="w-64">
              <MultiSelect
                options={data.availableMonths}
                value={months.length ? months : data.months}
                onChange={setMonths}
                placeholder="Month"
              />
            </Field>
            <Field label="Target Unit Session % (e.g. 0.08 = 8%)" className="w-56">
              <input
                type="number" min={0} max={1} step={0.01} value={targetUsp}
                onChange={(e) => setTargetUsp(Number(e.target.value) || 0)}
                className={inputCls}
              />
            </Field>
          </div>

          {data.rows.length === 0 ? (
            <div className="mt-4"><EmptyState message="No data for the selected months. Upload a monthly report to begin." /></div>
          ) : (
            <>
              <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
                <Kpi label="Total sales" value={fmt.money(kpis.sales)} />
                <Kpi label="Units ordered" value={fmt.int(kpis.units)} />
                <Kpi label="Sessions" value={fmt.int(kpis.sessions)} />
                <Kpi label="Unit Session % (wtd)" value={kpis.wUsp.toFixed(4)} />
                <Kpi label="Buy Box % (wtd)" value={kpis.wBb.toFixed(3)} />
              </div>

              <Card className="mt-4 p-4">
                <h2 className="mb-3 text-sm font-semibold">
                  ASINs by priority score <span className="ml-1 font-normal text-ink-3">(click an ASIN for its action checklist)</span>
                </h2>
                <DataTable data={data.rows} columns={columns} exportName="asin-health" dense pageSize={20} />
              </Card>
            </>
          )}
        </>
      )}

      <UploadDialog open={showUpload} onClose={() => setShowUpload(false)} onDone={refresh} />
    </div>
  );
}

function UploadDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const months = useMemo(() => {
    const out: string[] = [];
    const now = new Date();
    for (let i = 0; i < 24; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    return out;
  }, []);
  const [month, setMonth] = useState(months[1]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit() {
    if (!file) { setErr("Please attach the report."); return; }
    setBusy(true); setErr(null); setDone(null);
    try {
      const form = new FormData();
      form.set("month", month);
      form.set("file", file);
      const res = await postForm<{ rows: number }>("/api/health/upload", form);
      setDone(`Saved ${res.rows} rows for ${month}. Existing data for that month was replaced.`);
      setFile(null);
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Upload ASIN Health report">
      <div className="space-y-4 text-[13px]">
        <p className="text-ink-2">
          Seller Central → Reports → Business Reports → By ASIN → Detail Page Sales and Traffic <b>by Child Item</b> — full month.
        </p>
        <Field label="Month">
          <select value={month} onChange={(e) => setMonth(e.target.value)} className={inputCls}>
            {months.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Raw data file (.csv / .xlsx)">
          <input type="file" accept=".csv,.xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className={inputCls + " py-1.5"} />
        </Field>
        {err && <ErrorNote message={err} />}
        {done && <div className="rounded-lg bg-good/10 px-3 py-2 text-[var(--delta-good)]">{done}</div>}
        <Button onClick={submit} disabled={busy}>{busy ? "Processing…" : "Submit"}</Button>
      </div>
    </Dialog>
  );
}
