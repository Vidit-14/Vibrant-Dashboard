"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useApi, fmt, postJson } from "@/lib/client";
import { aggregate, type Period } from "@/lib/period";
import { DateRangePicker, MultiSelect, useDateRange } from "@/components/filters";
import { Button, Card, EmptyState, ErrorNote, Field, Kpi, PageHeader, Spinner, inputCls } from "@/components/ui";
import { MultiTrend } from "@/components/charts";
import DataTable from "@/components/DataTable";
import { type ColumnDef } from "@tanstack/react-table";
import { ArrowLeft } from "lucide-react";
import clsx from "clsx";

interface AdRow { date: string; campaign: string; spend: number; sales: number; orders: number; clicks: number; impressions: number }
interface AsinData {
  currency: string;
  rows: AdRow[];
  campaigns: string[];
  salesInsights: null | { adSales: number; adUnits: number; totalSales: number; totalUnits: number };
}

const PERIODS: { id: Period; label: string }[] = [
  { id: "daily", label: "Daily" }, { id: "weekly", label: "Weekly" }, { id: "monthly", label: "Monthly" },
];

export default function AsinDetailsPage() {
  const { asin } = useParams<{ asin: string }>();
  const search = useSearchParams();
  const country = (search.get("country") ?? "IND") as "IND" | "USA";
  const { range, setRange, ready } = useDateRange(30);
  const [period, setPeriod] = useState<Period>("daily");
  const [campaigns, setCampaigns] = useState<string[]>([]);
  const decodedAsin = decodeURIComponent(asin);

  const { data, error, loading } = useApi<AsinData>(
    ready ? `/api/ads/asin?country=${country}&asin=${encodeURIComponent(decodedAsin)}&start=${range.start}&end=${range.end}` : null,
  );

  const filtered = useMemo(
    () => (data?.rows ?? []).filter((r) => campaigns.length === 0 || campaigns.includes(r.campaign)),
    [data, campaigns],
  );

  const byCampaign = useMemo(
    () => aggregate(filtered, period, (r) => r.campaign),
    [filtered, period],
  );
  const chartData = useMemo(() => {
    const total = aggregate(filtered, period);
    return total
      .slice()
      .sort((a, b) => a.period.localeCompare(b.period))
      .map((a) => ({ ...a, acos: +a.acos.toFixed(1) }));
  }, [filtered, period]);

  const cur = data?.currency ?? "₹";
  const si = data?.salesInsights;
  const organic = si ? si.totalSales - si.adSales : 0;
  const adDependency = si && si.totalUnits > 0 ? (si.adUnits / si.totalUnits) * 100 : 0;

  const columns: ColumnDef<(typeof byCampaign)[number], unknown>[] = [
    { header: period === "daily" ? "Date" : period === "weekly" ? "Week of" : "Month", accessorKey: "period",
      cell: (c) => <span className="tnum">{String(c.getValue())}</span> },
    { header: "Campaign", accessorKey: "key",
      cell: (c) => (
        <Link href={`/dashboard/campaign/${encodeURIComponent(String(c.getValue()))}?country=${country}`} className="text-accent hover:underline">
          {String(c.getValue())}
        </Link>
      ) },
    { header: "Spend", accessorKey: "spend", cell: (c) => <span className="tnum">{fmt.money(c.getValue() as number, cur)}</span> },
    { header: "Sales", accessorKey: "sales", cell: (c) => <span className="tnum">{fmt.money(c.getValue() as number, cur)}</span> },
    { header: "Orders", accessorKey: "orders", cell: (c) => <span className="tnum">{fmt.int(c.getValue() as number)}</span> },
    { header: "Clicks", accessorKey: "clicks", cell: (c) => <span className="tnum">{fmt.int(c.getValue() as number)}</span> },
    { header: "Impr.", accessorKey: "impressions", cell: (c) => <span className="tnum">{fmt.int(c.getValue() as number)}</span> },
    { header: "ACOS", accessorKey: "acos", cell: (c) => <span className="tnum">{fmt.pct(c.getValue() as number)}</span> },
    { header: "ROAS", accessorKey: "roas", cell: (c) => <span className="tnum">{fmt.num(c.getValue() as number)}</span> },
    { header: "CTR", accessorKey: "ctr", cell: (c) => <span className="tnum">{fmt.pct(c.getValue() as number, 2)}</span> },
    { header: "CVR", accessorKey: "cvr", cell: (c) => <span className="tnum">{fmt.pct(c.getValue() as number, 2)}</span> },
  ];

  return (
    <div>
      <PageHeader title={`ASIN · ${decodedAsin}`} subtitle={country === "IND" ? "India" : "USA"}>
        <Link href="/dashboard" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[13px] font-medium text-ink-2 transition hover:bg-ink/5">
          <ArrowLeft className="size-4" /> Dashboard
        </Link>
        <DateRangePicker value={range} onChange={setRange} />
      </PageHeader>

      {error && <ErrorNote message={error} />}
      {loading && <Spinner label="Loading ASIN data…" />}

      {data && !loading && (
        <>
          {si && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi label="Total Ad Sales" value={fmt.money(si.adSales, cur)} hint="attributed to ads" />
              <Kpi label="Organic Sales" value={fmt.money(organic, cur)} hint="orders minus ad sales" />
              <Kpi label="Total Units" value={fmt.int(si.totalUnits)} hint="from Orders report" />
              <Kpi label="Ad Dependency" value={fmt.pct(adDependency)} hint="ad units / total units" />
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <MultiSelect options={data.campaigns} value={campaigns} onChange={setCampaigns} placeholder="Campaign" className="w-72" />
            <div className="glass ml-auto flex rounded-xl p-0.5">
              {PERIODS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPeriod(p.id)}
                  className={clsx(
                    "rounded-md px-3 py-1.5 text-xs font-semibold transition",
                    period === p.id ? "bg-accent text-accent-ink" : "text-ink-3 hover:text-ink",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="mt-4"><EmptyState message="No advertising data for the current filters." /></div>
          ) : (
            <>
              <div className="mt-4">
                <MultiTrend
                  data={chartData}
                  x="period"
                  panels={[
                    { key: "spend", label: `Spend (${cur})` },
                    { key: "sales", label: `Sales (${cur})` },
                    { key: "acos", label: "ACOS %" },
                    { key: "clicks", label: "Clicks" },
                    { key: "impressions", label: "Impressions" },
                    { key: "orders", label: "Orders" },
                  ]}
                />
              </div>

              <Card className="mt-5 p-4">
                <h2 className="mb-3 text-sm font-semibold">Performance by campaign ({period})</h2>
                <DataTable data={byCampaign} columns={columns} exportName={`asin-${decodedAsin}-${period}`} dense />
              </Card>
            </>
          )}

          <LogChangeCard asin={decodedAsin} campaigns={data.campaigns} />
        </>
      )}
    </div>
  );
}

function LogChangeCard({ asin, campaigns }: { asin: string; campaigns: string[] }) {
  const [comment, setComment] = useState("");
  const [campaign, setCampaign] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      await postJson("/api/logs", { asin, campaign, comment });
      setMsg("Change logged."); setComment("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-5 p-4">
      <h2 className="mb-3 text-sm font-semibold">Log a change for this ASIN</h2>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Comment" className="min-w-72 flex-1">
          <input value={comment} onChange={(e) => setComment(e.target.value)} className={inputCls} placeholder="What did you change?" />
        </Field>
        <Field label="Associated campaign (optional)" className="w-72">
          <select value={campaign} onChange={(e) => setCampaign(e.target.value)} className={inputCls}>
            <option value="">—</option>
            {campaigns.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Button onClick={submit} disabled={busy || !comment}>{busy ? "Saving…" : "Log change"}</Button>
      </div>
      {msg && <p className="mt-2 text-xs font-semibold text-[var(--delta-good)]">{msg}</p>}
      {err && <p className="mt-2 text-xs font-semibold text-critical">{err}</p>}
    </Card>
  );
}
