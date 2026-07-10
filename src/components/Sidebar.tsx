"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import clsx from "clsx";
import {
  BarChart3, LayoutDashboard, Undo2, CalendarRange, HeartPulse,
  MessageSquareQuote, Moon, Sun, LogOut, ShieldCheck,
} from "lucide-react";

const NAV = [
  { href: "/dashboard", label: "Ads Dashboard", icon: LayoutDashboard },
  { href: "/returns", label: "Return Fraud", icon: Undo2 },
  { href: "/sales-tracker", label: "Daily Sales Tracker", icon: CalendarRange },
  { href: "/asin-health", label: "ASIN Health", icon: HeartPulse },
  { href: "/voc", label: "Voice of Customer", icon: MessageSquareQuote },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [me, setMe] = useState<{ email: string; role: string } | null>(null);

  useEffect(() => {
    setMounted(true);
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then(setMe)
      .catch(() => {});
    // presence heartbeat while the app is open
    const ping = () => fetch("/api/auth/heartbeat", { method: "POST" }).catch(() => {});
    ping();
    const id = setInterval(ping, 4 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  return (
    <aside className="glass fixed inset-y-0 left-0 z-40 flex w-60 flex-col !rounded-none border-y-0 border-l-0">
      <div className="flex items-center gap-2.5 px-5 pb-5 pt-6">
        <div className="flex size-8 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--chart-1)] to-[var(--chart-2)] text-accent-ink shadow-sm">
          <BarChart3 className="size-4.5" />
        </div>
        <div className="leading-tight">
          <div className="text-[13px] font-semibold tracking-tight">Vibrant Commerce</div>
          <div className="text-[11px] text-ink-3">Analytics Console</div>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 px-3 py-2">
        {[...NAV, ...(me?.role === "admin" ? [{ href: "/admin", label: "Admin", icon: ShieldCheck }] : [])].map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                "flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-medium transition",
                active
                  ? "bg-gradient-to-r from-accent/15 to-[color-mix(in_srgb,var(--chart-2)_12%,transparent)] text-accent shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_18%,transparent)]"
                  : "text-ink-2 hover:bg-ink/5 hover:text-ink",
              )}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="space-y-0.5 border-t border-line px-3 py-3">
        {me && (
          <div className="truncate px-3 pb-1 text-[11px] text-ink-3" title={me.email}>
            {me.email}
          </div>
        )}
        <button
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-ink-2 transition hover:bg-ink/5 hover:text-ink"
        >
          {mounted && resolvedTheme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          {mounted && resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
        </button>
        <button
          onClick={logout}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-ink-2 transition hover:bg-ink/5 hover:text-ink"
        >
          <LogOut className="size-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
