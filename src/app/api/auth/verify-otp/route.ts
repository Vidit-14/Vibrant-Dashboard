import { createSessionCookie } from "@/lib/auth";
import { roleFor, recordLogin, normEmail } from "@/lib/users";
import { verifyOtp } from "@/lib/otp";

export async function POST(request: Request) {
  const { email, code } = await request.json();
  const e = normEmail(String(email ?? ""));
  if (!e || !code) return Response.json({ error: "Email and code required" }, { status: 400 });

  const role = await roleFor(e);
  if (!role) return Response.json({ error: "Access denied." }, { status: 403 });

  const result = await verifyOtp(e, String(code));
  if (!result.ok) return Response.json({ error: result.reason }, { status: 401 });

  await createSessionCookie(e, role);
  try {
    await recordLogin(e, request.headers.get("user-agent") ?? "");
  } catch {
    // audit failure must never block login
  }
  return Response.json({ ok: true, role });
}
