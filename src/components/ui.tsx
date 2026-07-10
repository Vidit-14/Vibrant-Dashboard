"use client";
import clsx from "clsx";
import { X, TrendingUp, TrendingDown, Loader2 } from "lucide-react";
import { useEffect } from "react";

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={clsx("glass rounded-2xl", className)}>
      {children}
    </div>
  );
}

export function PageHeader({
  title, subtitle, children,
}: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="bg-gradient-to-r from-[var(--accent)] to-[var(--chart-2)] bg-clip-text text-[26px] font-semibold tracking-tight text-transparent">
          {title}
        </h1>
        {subtitle && <p className="mt-1.5 text-sm text-ink-3">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2.5">{children}</div>}
    </div>
  );
}

export function Button({
  variant = "primary", className, ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  return (
    <button
      {...props}
      className={clsx(
        "inline-flex h-9 items-center justify-center gap-2 rounded-xl px-4 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" &&
          "bg-gradient-to-b from-[color-mix(in_srgb,var(--accent)_88%,white)] to-[var(--accent)] text-accent-ink shadow-[0_2px_10px_color-mix(in_srgb,var(--accent)_35%,transparent)] hover:brightness-105",
        variant === "ghost" && "glass text-ink-2 hover:text-ink",
        variant === "danger" && "bg-critical text-white hover:opacity-90",
        className,
      )}
    />
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-3">
      <Loader2 className="size-4 animate-spin" />
      {label}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-critical/30 bg-critical/5 px-4 py-3 text-sm text-critical">
      {message}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-4 py-12 text-center text-sm text-ink-3">
      {message}
    </div>
  );
}

/** KPI stat tile with optional period-over-period delta. */
export function Kpi({
  label, value, delta, deltaGoodWhen = "up", hint,
}: {
  label: string;
  value: string;
  delta?: number | null; // percent change vs previous period
  deltaGoodWhen?: "up" | "down";
  hint?: string;
}) {
  const hasDelta = delta !== undefined && delta !== null && Number.isFinite(delta);
  const up = hasDelta && (delta as number) >= 0;
  const good = hasDelta && (up ? deltaGoodWhen === "up" : deltaGoodWhen === "down");
  return (
    <Card className="min-w-0 px-5 py-4">
      <div className="truncate text-[11px] font-medium uppercase tracking-[0.12em] text-ink-3" title={label}>{label}</div>
      <div className={clsx(
        "tnum mt-1.5 font-semibold leading-tight break-words [overflow-wrap:anywhere]",
        value.length > 14 ? "text-lg" : value.length > 10 ? "text-xl" : "text-2xl",
      )}>{value}</div>
      <div className="mt-1.5 flex items-center gap-1.5 text-[12px]">
        {hasDelta && (
          <span
            className={clsx(
              "inline-flex items-center gap-1 font-semibold",
              good ? "text-[var(--delta-good)]" : "text-critical",
            )}
          >
            {up ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
            {Math.abs(delta as number).toFixed(1)}%
          </span>
        )}
        <span className="text-ink-3">{hint ?? (hasDelta ? "vs previous period" : "")}</span>
      </div>
    </Card>
  );
}

export function Dialog({
  open, onClose, title, children, wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[6vh]" onClick={onClose}>
      <div
        className={clsx(
          "glass-strong w-full rounded-2xl",
          wide ? "max-w-3xl" : "max-w-lg",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-ink-3 transition hover:bg-ink/5 hover:text-ink">
            <X className="size-4" />
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/** Colored pill for statuses/flags — always carries a text label (never color alone). */
export function Pill({
  children, tone, style,
}: { children: React.ReactNode; tone?: "good" | "warning" | "serious" | "critical" | "neutral"; style?: React.CSSProperties }) {
  return (
    <span
      style={style}
      className={clsx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold",
        tone === "good" && "bg-good/12 text-[var(--delta-good)]",
        tone === "warning" && "bg-warning/15 text-ink",
        tone === "serious" && "bg-serious/15 text-ink",
        tone === "critical" && "bg-critical/12 text-critical",
        (tone === "neutral" || !tone) && !style && "bg-ink/6 text-ink-2",
      )}
    >
      {children}
    </span>
  );
}

/** Simple labeled field wrapper for forms/filters. */
export function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={clsx("block", className)}>
      <span className="mb-1.5 block text-xs font-semibold text-ink-2">{label}</span>
      {children}
    </label>
  );
}

export const inputCls =
  "h-9 w-full rounded-xl border border-line bg-surface/70 px-3 text-[13px] outline-none ring-accent/30 backdrop-blur focus:ring-2";
export const selectCls = inputCls + " appearance-none pr-8";
