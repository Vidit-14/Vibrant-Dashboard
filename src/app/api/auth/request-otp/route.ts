import { roleFor, normEmail } from "@/lib/users";
import { issueOtp } from "@/lib/otp";
import { sendOtpEmail } from "@/lib/mailer";

export async function POST(request: Request) {
  const { email } = await request.json();
  const e = normEmail(String(email ?? ""));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
    return Response.json({ error: "Enter a valid email address" }, { status: 400 });
  }

  try {
    const role = await roleFor(e);
    if (!role) {
      return Response.json({ error: "Access denied. Ask an admin to add your email." }, { status: 403 });
    }
    const code = await issueOtp(e);
    try {
      const { delivery } = await sendOtpEmail(e, code);
      return Response.json({ ok: true, delivery });
    } catch (mailErr) {
      // never leak SMTP internals to the login page
      console.error("OTP email send failed:", (mailErr as Error).message);
      return Response.json(
        { error: "Could not send the code email — the mail service rejected the request. Ask an admin to check the SMTP settings." },
        { status: 502 },
      );
    }
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 429 });
  }
}
