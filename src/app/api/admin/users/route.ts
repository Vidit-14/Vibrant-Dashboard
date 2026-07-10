import { requireAdmin } from "@/lib/auth";
import {
  listAllowed, addAllowed, removeAllowed, listLoginEvents,
  getPresence, ONLINE_WINDOW_MS, normEmail,
} from "@/lib/users";

/** GET → allowlist merged with usage stats (last login, login count, online now). */
export async function GET() {
  try {
    await requireAdmin();
    const [allowed, events, presence] = await Promise.all([listAllowed(), listLoginEvents(), getPresence()]);

    const byEmail = new Map<string, { lastLogin: string | null; logins: number }>();
    for (const ev of events) {
      const e = byEmail.get(ev.email) ?? { lastLogin: null, logins: 0 };
      e.logins += 1;
      if (!e.lastLogin || ev.timestamp > e.lastLogin) e.lastLogin = ev.timestamp;
      byEmail.set(ev.email, e);
    }

    const now = Date.now();
    const users = allowed.map((u) => {
      const stats = byEmail.get(u.email);
      const seen = presence.get(u.email) ?? null;
      return {
        ...u,
        lastLogin: stats?.lastLogin ?? null,
        logins: stats?.logins ?? 0,
        online: seen !== null && now - seen < ONLINE_WINDOW_MS,
        lastSeen: seen ? new Date(seen).toISOString() : null,
      };
    });

    return Response.json({ users, recentEvents: events.slice(0, 50) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 403 });
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const { email } = await request.json();
    await addAllowed(String(email ?? ""), admin.email);
    return Response.json({ ok: true });
  } catch (e) {
    const msg = (e as Error).message;
    return Response.json({ error: msg }, { status: msg === "Admin access required" ? 403 : 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    await requireAdmin();
    const email = normEmail(new URL(request.url).searchParams.get("email") ?? "");
    if (!email) return Response.json({ error: "email required" }, { status: 400 });
    await removeAllowed(email);
    return Response.json({ ok: true });
  } catch (e) {
    const msg = (e as Error).message;
    return Response.json({ error: msg }, { status: msg === "Admin access required" ? 403 : 400 });
  }
}
