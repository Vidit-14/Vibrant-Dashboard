"use client";
/**
 * Theme-aware Recharts wrappers following the dataviz mark specs:
 * 2px lines, no permanent dots (≥8px active marker), hairline grid,
 * crosshair tooltip, one axis per chart (small multiples instead of dual axes),
 * legend whenever ≥2 series.
 */
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, Cell,
} from "recharts";
import { Card } from "./ui";

export const SERIES = [
  "var(--chart-1)", "var(--chart-2)", "var(--chart-3)",
  "var(--chart-4)", "var(--chart-5)", "var(--chart-6)",
];

const axisTick = { fill: "var(--ink-3)", fontSize: 11 } as const;

function ChartTooltip({
  active, payload, label, fmtValue,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color?: string }[];
  label?: string | number;
  fmtValue?: (v: number, name: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-semibold text-ink">{label}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 py-0.5 text-ink-2">
          <span className="inline-block size-2 rounded-full" style={{ background: p.color }} />
          <span>{p.name}</span>
          <span className="tnum ml-auto pl-4 font-semibold text-ink">
            {fmtValue ? fmtValue(p.value, p.name) : p.value.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

export interface SeriesDef {
  key: string;
  label: string;
  color?: string;
}

export function TrendChart({
  data, x, series, height = 260, fmtValue, fmtAxis,
}: {
  data: Record<string, string | number>[];
  x: string;
  series: SeriesDef[];
  height?: number;
  fmtValue?: (v: number, name: string) => string;
  fmtAxis?: (v: number) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--grid)" strokeWidth={1} vertical={false} />
        <XAxis dataKey={x} tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--baseline)" }} minTickGap={28} />
        <YAxis tick={axisTick} tickLine={false} axisLine={false} width={52} tickFormatter={fmtAxis} />
        <Tooltip
          content={<ChartTooltip fmtValue={fmtValue} />}
          cursor={{ stroke: "var(--baseline)", strokeDasharray: "3 3" }}
        />
        {series.length > 1 && (
          <Legend wrapperStyle={{ fontSize: 12, color: "var(--ink-2)" }} iconType="circle" iconSize={8} />
        )}
        {series.map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color ?? SERIES[i % SERIES.length]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Small-multiples grid: one metric per panel — never a dual axis. */
export function MultiTrend({
  data, x, panels, fmtValue,
}: {
  data: Record<string, string | number>[];
  x: string;
  panels: { key: string; label: string; color?: string; fmt?: (v: number) => string }[];
  fmtValue?: (v: number, name: string) => string;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {panels.map((p, i) => (
        <Card key={p.key} className="p-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-ink-2">
            <span className="inline-block size-2 rounded-full" style={{ background: p.color ?? SERIES[i % SERIES.length] }} />
            {p.label}
          </div>
          <TrendChart
            data={data}
            x={x}
            height={170}
            series={[{ key: p.key, label: p.label, color: p.color ?? SERIES[i % SERIES.length] }]}
            fmtValue={fmtValue}
            fmtAxis={p.fmt}
          />
        </Card>
      ))}
    </div>
  );
}

export function BarsChart({
  data, x, y, label, height = 260, color = SERIES[0], fmtValue, colors,
}: {
  data: Record<string, string | number>[];
  x: string;
  y: string;
  label: string;
  height?: number;
  color?: string;
  colors?: string[]; // optional per-bar colors (e.g. VOC scale) — labels must accompany
  fmtValue?: (v: number, name: string) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--grid)" strokeWidth={1} vertical={false} />
        <XAxis dataKey={x} tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--baseline)" }} interval={0} angle={data.length > 8 ? -30 : 0} textAnchor={data.length > 8 ? "end" : "middle"} height={data.length > 8 ? 60 : 30} />
        <YAxis tick={axisTick} tickLine={false} axisLine={false} width={52} />
        <Tooltip content={<ChartTooltip fmtValue={fmtValue} />} cursor={{ fill: "var(--grid)", opacity: 0.4 }} />
        <Bar dataKey={y} name={label} fill={color} radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={false}>
          {colors && data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
