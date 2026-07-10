"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/client";
import { BarChart3, Mail, ShieldCheck, ArrowLeft } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  async function requestCode(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await postJson<{ delivery: "email" | "console" }>("/api/auth/request-otp", { email });
      setStep("code");
      setNotice(
        res.delivery === "email"
          ? `We sent a 6-digit code to ${email.trim()}.`
          : "Email sending is not configured yet — the code was printed in the server console.",
      );
      setTimeout(() => codeRef.current?.focus(), 50);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await postJson("/api/auth/verify-otp", { email, code });
      router.replace("/dashboard");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-page p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--chart-1)] to-[var(--chart-2)] text-accent-ink shadow-md">
            <BarChart3 className="size-6" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Vibrant Commerce Console</h1>
            <p className="mt-1 text-sm text-ink-3">Amazon Ads &amp; ASIN performance analytics</p>
          </div>
        </div>

        {step === "email" ? (
          <form onSubmit={requestCode} className="glass rounded-2xl p-6">
            <label className="block text-sm font-medium text-ink-2">Work email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoFocus
              placeholder="you@company.com"
              className="mt-1.5 w-full rounded-xl border border-line bg-surface/70 px-3 py-2 text-sm outline-none ring-accent/30 focus:ring-2"
            />
            <p className="mt-2 text-xs text-ink-3">
              Access is invite-only. If your email is approved, we&apos;ll send you a one-time code.
            </p>
            {error && (
              <p className="mt-3 rounded-lg bg-critical/10 px-3 py-2 text-sm text-critical">{error}</p>
            )}
            <button
              type="submit"
              disabled={busy || !email}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-[color-mix(in_srgb,var(--accent)_88%,white)] to-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-accent-ink shadow-md transition hover:brightness-105 disabled:opacity-50"
            >
              <Mail className="size-4" />
              {busy ? "Checking…" : "Continue with email"}
            </button>
          </form>
        ) : (
          <form onSubmit={verify} className="glass rounded-2xl p-6">
            <button
              type="button"
              onClick={() => { setStep("email"); setCode(""); setError(null); setNotice(null); }}
              className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-ink-3 transition hover:text-ink"
            >
              <ArrowLeft className="size-3.5" /> Use a different email
            </button>
            <label className="block text-sm font-medium text-ink-2">Enter the 6-digit code</label>
            <input
              ref={codeRef}
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="••••••"
              className="tnum mt-1.5 w-full rounded-xl border border-line bg-surface/70 px-3 py-2.5 text-center text-2xl font-semibold tracking-[0.5em] outline-none ring-accent/30 focus:ring-2"
            />
            {notice && <p className="mt-2 text-xs text-ink-3">{notice}</p>}
            {error && (
              <p className="mt-3 rounded-lg bg-critical/10 px-3 py-2 text-sm text-critical">{error}</p>
            )}
            <button
              type="submit"
              disabled={busy || code.length !== 6}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-[color-mix(in_srgb,var(--accent)_88%,white)] to-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-accent-ink shadow-md transition hover:brightness-105 disabled:opacity-50"
            >
              <ShieldCheck className="size-4" />
              {busy ? "Verifying…" : "Sign in"}
            </button>
            <button
              type="button"
              onClick={() => requestCode()}
              disabled={busy}
              className="mt-2 w-full text-center text-xs font-medium text-accent transition hover:underline disabled:opacity-50"
            >
              Resend code
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
