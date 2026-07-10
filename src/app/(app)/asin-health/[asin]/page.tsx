"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useApi, fmt, postJson } from "@/lib/client";
import { Button, Card, EmptyState, ErrorNote, Kpi, PageHeader, Pill, Spinner } from "@/components/ui";
import { MultiTrend } from "@/components/charts";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import clsx from "clsx";

interface ChecklistData {
  type: string;
  items: { item: string; status: boolean }[];
  metrics: null | {
    sales: number; units: number; sessions: number; usp: number; buyBox: number;
    trafficFlag: string; conversionFlag: string; buyBoxFlag: string; opportunity: string;
  };
}
interface HistoryData { history: { month: string; units: number; sales: number; sessions: number; usp: number }[] }

export default function ChecklistPage() {
  const { asin } = useParams<{ asin: string }>();
  const search = useSearchParams();
  const month = search.get("month") ?? "";
  const targetUsp = search.get("targetUsp") ?? "0.08";
  const decodedAsin = decodeURIComponent(asin);

  const { data, error, loading, refresh } = useApi<ChecklistData>(
    `/api/health/checklist?month=${month}&asin=${encodeURIComponent(decodedAsin)}&targetUsp=${targetUsp}`,
  );
  const { data: hist } = useApi<HistoryData>(`/api/health/history?asin=${encodeURIComponent(decodedAsin)}`);

  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (data) setChecked(Object.fromEntries(data.items.map((i) => [i.item, i.status])));
  }, [data]);

  const doneCount = useMemo(() => Object.values(checked).filter(Boolean).length, [checked]);

  async function save() {
    if (!data) return;
    setBusy(true); setMsg(null);
    try {
      await postJson("/api/health/checklist", {
        month,
        asin: decodedAsin,
        items: data.items.map((i) => ({ item: i.item, status: !!checked[i.item] })),
      });
      setMsg("Checklist saved.");
      refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const histChart = useMemo(
    () => (hist?.history ?? []).map((h) => ({ ...h, usp: +h.usp.toFixed(4) })),
    [hist],
  );

  return (
    <div>
      <PageHeader title={`Checklist · ${decodedAsin}`} subtitle={`Month: ${month}`}>
        <Link href="/asin-health" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[13px] font-medium text-ink-2 transition hover:bg-ink/5">
          <ArrowLeft className="size-4" /> ASIN Health
        </Link>
      </PageHeader>

      {error && <ErrorNote message={error} />}
      {loading && <Spinner label="Loading checklist…" />}

      {data && !loading && (
        <>
          {data.metrics && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              <Kpi label="Sales" value={fmt.money(data.metrics.sales)} />
              <Kpi label="Units" value={fmt.int(data.metrics.units)} />
              <Kpi label="Sessions" value={fmt.int(data.metrics.sessions)} />
              <Kpi label="Unit Session %" value={data.metrics.usp.toFixed(4)} />
              <Kpi label="Buy Box %" value={data.metrics.buyBox.toFixed(3)} />
            </div>
          )}

          <Card className="mt-4 p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Action checklist</h2>
                <div className="mt-1 flex items-center gap-2">
                  <Pill tone={data.type === "High Traffic / Low Conv" ? "warning" : "critical"}>{data.type}</Pill>
                  <span className="tnum text-xs text-ink-3">{doneCount}/{data.items.length} complete</span>
                </div>
              </div>
              <Button onClick={save} disabled={busy}>
                <CheckCircle2 className="size-4" />
                {busy ? "Saving…" : "Save changes"}
              </Button>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-ink/8">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{ width: `${data.items.length ? (doneCount / data.items.length) * 100 : 0}%` }}
              />
            </div>
            <ul className="mt-4 space-y-1">
              {data.items.map(({ item }) => (
                <li key={item}>
                  <label className={clsx(
                    "flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5 text-[13px] transition hover:bg-ink/4",
                    checked[item] && "text-ink-3 line-through",
                  )}>
                    <input
                      type="checkbox"
                      checked={!!checked[item]}
                      onChange={(e) => setChecked((c) => ({ ...c, [item]: e.target.checked }))}
                      className="mt-0.5 size-4 accent-[var(--accent)]"
                    />
                    {item}
                  </label>
                </li>
              ))}
            </ul>
            {msg && <p className="mt-3 text-xs font-semibold text-[var(--delta-good)]">{msg}</p>}
          </Card>

          <h2 className="mb-3 mt-6 text-sm font-semibold">Historical performance</h2>
          {histChart.length === 0 ? (
            <EmptyState message="No history for this ASIN yet." />
          ) : (
            <MultiTrend
              data={histChart}
              x="month"
              panels={[
                { key: "units", label: "Units ordered" },
                { key: "sales", label: "Sales (₹)" },
                { key: "sessions", label: "Sessions" },
                { key: "usp", label: "Unit Session %" },
              ]}
            />
          )}
        </>
      )}
    </div>
  );
}
