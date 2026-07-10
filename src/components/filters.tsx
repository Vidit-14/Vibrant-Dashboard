"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, CalendarDays, X } from "lucide-react";
import clsx from "clsx";
import { dateKey } from "@/lib/parse";

/* ---------- date range ---------- */

export interface Range { start: string; end: string }

export function defaultRange(days = 30): Range {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - (days - 1));
  return { start: dateKey(start), end: dateKey(end) };
}

const STORAGE_KEY = "vibrant.dateRange";

/**
 * Date range shared across pages within the session — survives navigation
 * (dashboard → ASIN details → campaign details keep the same window).
 * `ready` flips true after the saved value is loaded; gate fetches on it
 * to avoid a throwaway request with the default range.
 */
export function useDateRange(days = 30): { range: Range; setRange: (r: Range) => void; ready: boolean } {
  const [range, setRangeState] = useState<Range>(() => defaultRange(days));
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        const r = JSON.parse(saved) as Range;
        if (r.start && r.end) setRangeState(r);
      }
    } catch { /* ignore corrupt storage */ }
    setReady(true);
  }, []);

  const setRange = (r: Range) => {
    setRangeState(r);
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(r)); } catch { /* quota */ }
  };
  return { range, setRange, ready };
}

const PRESETS: { label: string; range: () => Range }[] = [
  { label: "Last 7 days", range: () => defaultRange(7) },
  { label: "Last 30 days", range: () => defaultRange(30) },
  { label: "Last 90 days", range: () => defaultRange(90) },
  {
    label: "Month to date",
    range: () => {
      const now = new Date();
      return { start: dateKey(new Date(now.getFullYear(), now.getMonth(), 1)), end: dateKey(now) };
    },
  },
  {
    label: "Last month",
    range: () => {
      const now = new Date();
      return {
        start: dateKey(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        end: dateKey(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
    },
  },
];

function fmtDay(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

interface MonthGridProps {
  month: Date; // first of month
  range: Range;
  pending: string | null;
  hover: string | null;
  onPick: (day: string) => void;
  onHover: (day: string | null) => void;
}

function MonthGrid({ month, range, pending, hover, onPick, onHover }: MonthGridProps) {
  const today = dateKey(new Date());
  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const lead = (first.getDay() + 6) % 7; // Monday-start
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const out: (string | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= daysInMonth; d++) {
      out.push(dateKey(new Date(month.getFullYear(), month.getMonth(), d)));
    }
    return out;
  }, [month]);

  // selection window shown while picking: pending → hover
  const [selStart, selEnd] = useMemo(() => {
    if (pending) {
      const other = hover ?? pending;
      return pending <= other ? [pending, other] : [other, pending];
    }
    return [range.start, range.end];
  }, [pending, hover, range]);

  return (
    <div className="w-60">
      <div className="mb-1 text-center text-[13px] font-semibold">
        {month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
      </div>
      <div className="grid grid-cols-7 text-center text-[10px] font-semibold uppercase text-ink-3">
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => <span key={d} className="py-1">{d}</span>)}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((day, i) => {
          if (!day) return <span key={`x${i}`} />;
          const inRange = day >= selStart && day <= selEnd;
          const isEdge = day === selStart || day === selEnd;
          const future = day > today;
          return (
            <button
              key={day}
              disabled={future}
              onClick={() => onPick(day)}
              onMouseEnter={() => onHover(day)}
              onMouseLeave={() => onHover(null)}
              className={clsx(
                "tnum relative h-8 text-[12px] transition",
                future && "cursor-not-allowed text-ink-3/40",
                !future && !inRange && "rounded-lg text-ink-2 hover:bg-ink/8",
                inRange && !isEdge && "bg-accent/12 text-ink",
                isEdge && "z-10 rounded-lg bg-accent font-semibold text-accent-ink shadow-sm",
                day === selStart && inRange && !isEdge && "rounded-l-lg",
                day === today && !inRange && "font-bold text-accent",
              )}
            >
              {Number(day.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DateRangePicker({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(() => {
    const d = new Date(value.end + "T00:00:00");
    return new Date(d.getFullYear(), d.getMonth() - 1, 1);
  });
  const [pending, setPending] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) { setOpen(false); setPending(null); }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function pick(day: string) {
    if (!pending) {
      setPending(day);
    } else {
      const [start, end] = pending <= day ? [pending, day] : [day, pending];
      onChange({ start, end });
      setPending(null);
      setOpen(false);
    }
  }

  const nextMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  const isActivePreset = (p: (typeof PRESETS)[number]) => {
    const r = p.range();
    return r.start === value.start && r.end === value.end;
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="glass inline-flex h-9 items-center gap-2 rounded-xl px-3.5 text-[13px] font-medium text-ink-2 transition hover:text-ink"
      >
        <CalendarDays className="size-4 text-accent" />
        <span className="tnum">{fmtDay(value.start)} – {fmtDay(value.end)}</span>
        <ChevronDown className={clsx("size-3.5 text-ink-3 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="glass-strong absolute right-0 z-40 mt-2 rounded-2xl p-4">
          <div className="flex gap-4">
            <div className="flex w-36 flex-col gap-1 border-r border-line pr-4">
              <span className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-3">Quick select</span>
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => { onChange(p.range()); setPending(null); setOpen(false); }}
                  className={clsx(
                    "flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[12px] font-medium transition",
                    isActivePreset(p) ? "bg-accent/12 text-accent" : "text-ink-2 hover:bg-ink/6",
                  )}
                >
                  {p.label}
                  {isActivePreset(p) && <Check className="size-3.5" />}
                </button>
              ))}
              <p className="mt-2 text-[11px] leading-snug text-ink-3">
                {pending ? "Now pick the end date" : "Or click two dates on the calendar"}
              </p>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <button
                  onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
                  className="rounded-lg p-1.5 text-ink-3 transition hover:bg-ink/8 hover:text-ink"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <button
                  onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
                  className="rounded-lg p-1.5 text-ink-3 transition hover:bg-ink/8 hover:text-ink"
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
              <div className="flex gap-6">
                <MonthGrid month={cursor} range={value} pending={pending} hover={hover} onPick={pick} onHover={setHover} />
                <div className="hidden sm:block">
                  <MonthGrid month={nextMonth} range={value} pending={pending} hover={hover} onPick={pick} onHover={setHover} />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- multi select ---------- */

export function MultiSelect({
  options, value, onChange, placeholder, className,
}: {
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const filtered = query
    ? options.filter((o) => o.toLowerCase().includes(query.toLowerCase()))
    : options;

  function toggle(opt: string) {
    onChange(value.includes(opt) ? value.filter((v) => v !== opt) : [...value, opt]);
  }

  return (
    <div className={clsx("relative", className)} ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="glass flex h-9 w-full items-center justify-between gap-2 rounded-xl px-3.5 text-[13px] text-ink-2 transition hover:text-ink"
      >
        <span className="truncate">
          {value.length === 0 ? placeholder : `${placeholder}: ${value.length} selected`}
        </span>
        <span className="flex items-center gap-1">
          {value.length > 0 && (
            <X
              className="size-3.5 text-ink-3 hover:text-ink"
              onClick={(e) => {
                e.stopPropagation();
                onChange([]);
              }}
            />
          )}
          <ChevronDown className="size-3.5 text-ink-3" />
        </span>
      </button>
      {open && (
        <div className="glass-strong absolute z-40 mt-2 max-h-72 w-full min-w-56 overflow-y-auto rounded-2xl p-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type to filter…"
            className="mb-1.5 h-8 w-full rounded-lg border border-line bg-surface/70 px-2.5 text-xs outline-none"
            autoFocus
          />
          {filtered.length === 0 && <div className="px-3 py-2 text-xs text-ink-3">No matches</div>}
          {filtered.slice(0, 250).map((opt) => (
            <button
              key={opt}
              onClick={() => toggle(opt)}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink-2 transition hover:bg-ink/6"
            >
              <span
                className={clsx(
                  "flex size-4 shrink-0 items-center justify-center rounded border",
                  value.includes(opt) ? "border-accent bg-accent text-accent-ink" : "border-line",
                )}
              >
                {value.includes(opt) && <Check className="size-3" />}
              </span>
              <span className="truncate">{opt}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
