import "server-only";
import nodemailer from "nodemailer";

/**
 * Sends the OTP email via SMTP (SMTP_HOST/PORT/USER/PASS/FROM env vars —
 * a Gmail app password works). When SMTP is not configured, the code is
 * printed to the server console instead so login still works in development.
 */
export async function sendOtpEmail(to: string, code: string): Promise<{ delivery: "email" | "console" }> {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.log(`\n┌────────────────────────────────────────────┐`);
    console.log(`│  LOGIN CODE for ${to}`);
    console.log(`│  ${code}   (SMTP not configured — dev mode)`);
    console.log(`└────────────────────────────────────────────┘\n`);
    return { delivery: "console" };
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST.trim(),
    port: Number(SMTP_PORT ?? 587),
    secure: Number(SMTP_PORT ?? 587) === 465,
    // Gmail shows app passwords with spaces — strip them so a verbatim paste works
    auth: { user: SMTP_USER.trim(), pass: SMTP_PASS.replace(/\s+/g, "") },
  });

  await transporter.sendMail({
    from: SMTP_FROM ?? SMTP_USER,
    to,
    subject: `${code} is your Vibrant Commerce Console code`,
    text: `Your one-time login code is ${code}. It expires in 10 minutes.\n\nIf you didn't request this, you can ignore this email.`,
    html: `
      <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:420px;margin:0 auto;padding:24px">
        <h2 style="margin:0 0 8px;font-size:18px">Vibrant Commerce Console</h2>
        <p style="color:#52514e;margin:0 0 20px">Use this code to sign in. It expires in 10 minutes.</p>
        <div style="background:#f0f4fa;border-radius:12px;padding:18px;text-align:center;font-size:30px;font-weight:700;letter-spacing:8px">${code}</div>
        <p style="color:#898781;font-size:12px;margin:20px 0 0">If you didn't request this, you can ignore this email.</p>
      </div>`,
  });
  return { delivery: "email" };
}
