import { getSession } from "@/lib/auth";
import { touch } from "@/lib/users";

/** Presence ping — the app shell calls this every few minutes while open. */
export async function POST() {
  const s = await getSession();
  if (!s) return Response.json({ error: "Unauthorized" }, { status: 401 });
  await touch(s.email);
  return Response.json({ ok: true });
}
