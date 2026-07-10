"use client";
import { useState } from "react";
import { useApi, postJson } from "@/lib/client";
import { Button, Card, EmptyState, ErrorNote, Kpi, PageHeader, Pill, Spinner, inputCls } from "@/components/ui";
import { UserPlus, Trash2, ShieldCheck, Circle } from "lucide-react";

interface AdminUser {
  email: string;
  role: "admin" | "member";
  addedBy: string;
  addedAt: string;
  lastLogin: string | null;
  logins: number;
  online: boolean;
  lastSeen: string | null;
}
interface LoginEvent { email: string; timestamp: string; userAgent: string }
interface AdminData { users: AdminUser[]; recentEvents: LoginEvent[] }

function ago(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function AdminPage() {
  const { data, error, loading, refresh } = useApi<AdminData>("/api/admin/users");
  const [newEmail, setNewEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function addUser(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await postJson("/api/admin/users", { email: newEmail });
      setNewEmail("");
      refresh();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removeUser(email: string) {
    if (!confirm(`Remove access for ${email}?`)) return;
    try {
      const res = await fetch(`/api/admin/users?email=${encodeURIComponent(email)}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error);
      refresh();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  const online = data?.users.filter((u) => u.online).length ?? 0;
  const loggedInLast7d = data?.users.filter(
    (u) => u.lastLogin && Date.now() - Date.parse(u.lastLogin) < 7 * 86400000,
  ).length ?? 0;

  return (
    <div>
      <PageHeader title="Admin" subtitle="Access control and usage overview" />

      {error && <ErrorNote message={error} />}
      {loading && <Spinner label="Loading users…" />}

      {data && !loading && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Users with access" value={String(data.users.length)} />
            <Kpi label="Online now" value={String(online)} hint="active in last 10 min" />
            <Kpi label="Active last 7 days" value={String(loggedInLast7d)} />
            <Kpi label="Total logins recorded" value={String(data.users.reduce((s, u) => s + u.logins, 0))} />
          </div>

          <Card className="mt-5 p-5">
            <h2 className="mb-3 text-sm font-semibold">Grant access</h2>
            <form onSubmit={addUser} className="flex flex-wrap items-center gap-2.5">
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="teammate@company.com"
                className={inputCls + " max-w-sm"}
              />
              <Button type="submit" disabled={busy || !newEmail}>
                <UserPlus className="size-4" />
                {busy ? "Adding…" : "Add email"}
              </Button>
            </form>
            {formError && <p className="mt-2 text-xs font-semibold text-critical">{formError}</p>}
            <p className="mt-2 text-xs text-ink-3">
              Added emails can sign in with a one-time code. Admins are configured in the server environment and cannot be removed here.
            </p>
          </Card>

          <Card className="mt-5 p-5">
            <h2 className="mb-3 text-sm font-semibold">Users</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] font-medium uppercase tracking-wider text-ink-3">
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Email</th>
                    <th className="py-2 pr-3">Role</th>
                    <th className="py-2 pr-3">Last login</th>
                    <th className="py-2 pr-3">Last seen</th>
                    <th className="py-2 pr-3 text-right">Logins</th>
                    <th className="py-2 pr-3">Added by</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {data.users.map((u) => (
                    <tr key={u.email} className="border-b border-grid last:border-b-0">
                      <td className="py-2.5 pr-3">
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                          <Circle
                            className="size-2.5"
                            fill={u.online ? "var(--status-good)" : "var(--baseline)"}
                            stroke="none"
                          />
                          {u.online ? "Online" : "Offline"}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 font-medium">{u.email}</td>
                      <td className="py-2.5 pr-3">
                        {u.role === "admin"
                          ? <Pill tone="good"><ShieldCheck className="size-3" /> Admin</Pill>
                          : <Pill tone="neutral">Member</Pill>}
                      </td>
                      <td className="tnum py-2.5 pr-3 text-ink-2">{ago(u.lastLogin)}</td>
                      <td className="tnum py-2.5 pr-3 text-ink-2">{ago(u.lastSeen)}</td>
                      <td className="tnum py-2.5 pr-3 text-right">{u.logins}</td>
                      <td className="py-2.5 pr-3 text-ink-3">{u.addedBy || "—"}</td>
                      <td className="py-2.5 text-right">
                        {u.role !== "admin" && (
                          <button
                            onClick={() => removeUser(u.email)}
                            className="rounded-lg p-1.5 text-ink-3 transition hover:bg-critical/10 hover:text-critical"
                            title="Revoke access"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="mt-5 p-5">
            <h2 className="mb-3 text-sm font-semibold">Recent logins</h2>
            {data.recentEvents.length === 0 ? (
              <EmptyState message="No logins recorded yet." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] font-medium uppercase tracking-wider text-ink-3">
                      <th className="py-2 pr-3">When</th>
                      <th className="py-2 pr-3">Email</th>
                      <th className="py-2">Device</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentEvents.map((ev, i) => (
                      <tr key={i} className="border-b border-grid last:border-b-0">
                        <td className="tnum whitespace-nowrap py-2 pr-3 text-ink-2">
                          {ev.timestamp.slice(0, 16).replace("T", " ")} <span className="text-ink-3">({ago(ev.timestamp)})</span>
                        </td>
                        <td className="py-2 pr-3 font-medium">{ev.email}</td>
                        <td className="max-w-96 truncate py-2 text-xs text-ink-3" title={ev.userAgent}>{ev.userAgent}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
