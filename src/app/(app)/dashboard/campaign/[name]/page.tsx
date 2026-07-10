"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useApi, fmt } from "@/lib/client";
import { aggregate, type Period } from "@/lib/period";
import { DateRangePicker, MultiSelect, useDateRange } from "@/components/filters";
import { Card, EmptyState, ErrorNote, PageHeader, Spinner } from "@/components/ui";
import { MultiTrend } from "@/components/charts";
import DataTable from "@/components/DataTable";
import { type ColumnDef } from "@tanstack/react-table";
import { ArrowLeft } from "lucide-react";
import clsx from "clsx";

interface TgtRow {
  date: string; targeting: string; matchType: string;
  spend: number; sales: number; orders: number; clicks: number; impressions: number;
}
interface CampaignData {
  currency: string;
  rows: TgtRow[];
  targets: string[];
  matchTypes: string[];
}

const PERIODS: { id: Period; label: string }[] = [
  { id: "daily", label: "Daily" }, { id: "weekly", label: "Weekly" }, { id: "monthly", label: "Monthly" },
];

export default function CampaignDetailsPage() {
  const { name } = useParams<{ name: string }>();
  const search = useSearchParams();
  const country = (search.get("country") ?? "IND") as "IND" | "USA";
  const campaign = decodeURIComponent(name);
  const { range, setRange, ready } = useDateRange(30);
  const [period, setPeriod] = useState<Period>("daily");
  const [targets, setTargets] = useState<string[]>([]);
  const [matchTypes, setMatchTypes] = useState<string[]>([]);
  const [keyword, setKeyword] = useState<string>("");

  const { data, error, loading } = useApi<CampaignData>(
    ready ? `/api/ads/campaign?country=${country}&campaign=${encodeURIComponent(campaign)}&start=${range.start}&end=${range.end}` : null,
  );

  const filtered = useMemo(
    () =>
      (data?.rows ?? []).filter(
        (r) =>
          (targets.length === 0 || targets.includes(r.targeting)) &&
          (matchTypes.length === 0 || matchTypes.includes(r.matchType)),
      ),
    [data, targets, matchTypes],
  );

  const overall = useMemo(
    () =>
      aggregate(filtered, period)
        .slice()
        .sort((a, b) => a.period.localeCompare(b.period))
        .map((a) => ({ ...a, acos: +a.acos.toFixed(1) })),
    [filtered, period],
  );

  const byKeyword = useMemo(
    () => aggregate(filtered, period, (r) => `${r.targeting}␟${r.matchType}`).map((a) => {
      const [targeting, matchType] = a.key.split("␟");
      return { ...a, targeting, matchType };
    }),
    [filtered, period],
  );

  const keywordChart = useMemo(() => {
    if (!keyword) return [];
    return byKeyword
      .filter((r) => r.targeting === keyword)
      .slice()
      .sort((a, b) => a.period.localeCompare(b.period))
      .map((a) => ({ ...a, acos: +a.acos.toFixed(1) }));
  }, [byKeyword, keyword]);

  const cur = data?.currency ?? "₹";

  const columns: ColumnDef<(typeof byKeyword)[number], unknown>[] = [
    { header: period === "daily" ? "Date" : period === "weekly" ? "Week of" : "Month", accessorKey: "period",
      cell: (c) => <span className="tnum">{String(c.getValue())}</span> },
    { header: "Targeting", accessorKey: "targeting" },
    { header: "Match", accessorKey: "matchType" },
    { header: "Spend", accessorKey: "spend", cell: (c) => <span className="tnum">{fmt.money(c.getValue() as number, cur)}</span> },
    { header: "Sales", accessorKey: "sales", cell: (c) => <span className="tnum">{fmt.money(c.getValue() as number, cur)}</span> },
    { header: "Orders", accessorKey: "orders", cell: (c) => <span className="tnum">{fmt.int(c.getValue() as number)}</span> },
    { header: "Clicks", accessorKey: "clicks", cell: (c) => <span className="tnum">{fmt.int(c.getValue() as number)}</span> },
    { header: "Impr.", accessorKey: "impressions", cell: (c) => <span className="tnum">{fmt.int(c.getValue() as number)}</span> },
    { header: "ACOS", accessorKey: "acos", cell: (c) => <span className="tnum">{fmt.pct(c.getValue() as number)}</span> },
    { header: "CVR", accessorKey: "cvr", cell: (c) => <span className="tnum">{fmt.pct(c.getValue() as number, 2)}</span> },
  ];

  return (
    <div>
      <PageHeader title="Campaign details" subtitle={campaign}>
        <Link href="/dashboard" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[13px] font-medium text-ink-2 transition hover:bg-ink/5">
          <ArrowLeft className="size-4" /> Dashboard
        </Link>
        <DateRangePicker value={range} onChange={setRange} />
      </PageHeader>

      {error && <ErrorNote message={error} />}
      {loading && <Spinner label="Loading campaign data…" />}

      {data && !loading && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <MultiSelect options={data.targets} value={targets} onChange={setTargets} placeholder="Targeting" className="w-72" />
            <MultiSelect options={data.matchTypes} value={matchTypes} onChange={setMatchTypes} placeholder="Match type" className="w-52" />
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
            <div className="mt-4"><EmptyState message="No data for the current filter selection." /></div>
          ) : (
            <>
              <div className="mt-4">
                <MultiTrend
                  data={overall}
                  x="period"
                  panels={[
                    { key: "spend", label: `Spend (${cur})` },
                    { key: "acos", label: "ACOS %" },
                    { key: "clicks", label: "Clicks" },
                    { key: "impressions", label: "Impressions" },
                    { key: "orders", label: "Orders" },
                    { key: "sales", label: `Sales (${cur})` },
                  ]}
                />
              </div>

              <Card className="mt-5 p-4">
                <h2 className="mb-3 text-sm font-semibold">Performance by keyword ({period})</h2>
                <DataTable
                  data={byKeyword}
                  columns={columns}
                  exportName={`campaign-${period}`}
                  dense
                  onRowClick={(r) => setKeyword(r.targeting)}
                />
                <p className="mt-2 text-[11px] text-ink-3">Click a row to chart that keyword below.</p>
              </Card>

              {keyword && keywordChart.length > 0 && (
                <Card className="mt-5 p-4">
                  <h2 className="mb-3 text-sm font-semibold">
                    Keyword trend · <span className="font-mono text-accent">{keyword}</span>
                  </h2>
                  <MultiTrend
                    data={keywordChart}
                    x="period"
                    panels={[
                      { key: "acos", label: "ACOS %" },
                      { key: "clicks", label: "Clicks" },
                      { key: "impressions", label: "Impressions" },
                    ]}
                  />
                </Card>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
