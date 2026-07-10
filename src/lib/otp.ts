import "server-only";
import { createHash, randomInt } from "crypto";
import { normEmail } from "./users";
import { usingSupabase, dbGetOtp, dbSetOtp, dbDeleteOtp, dbBumpOtpAttempts, type OtpRecord } from "./db";

/**
 * One-time-password store. Codes are hashed with the session secret, live 10
 * minutes, allow 5 attempts, and can be re-sent after 60s.
 *
 * Backed by the otp_codes table on Supabase so it works on serverless hosts
 * (Vercel) where each request may hit a different instance; falls back to an
 * in-memory map for local Sheets-only development.
 */

const memory: Map<string, OtpRecord> = ((globalThis as Record<string, unknown>).__otpStore ??=
  new Map()) as Map<string, OtpRecord>;

const TTL_MS = 10 * 60 * 1000;
const RESEND_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

function hash(email: string, code: string): string {
  return createHash("sha256").update(`${email}:${code}:${process.env.SESSION_SECRET}`).digest("hex");
}

async function getRec(email: string): Promise<OtpRecord | null> {
  return usingSupabase() ? dbGetOtp(email) : memory.get(email) ?? null;
}

async function setRec(rec: OtpRecord) {
  if (usingSupabase()) await dbSetOtp(rec);
  else memory.set(rec.email, rec);
}

async function delRec(email: string) {
  if (usingSupabase()) await dbDeleteOtp(email);
  else memory.delete(email);
}

/** Generate + store a code. Throws if asked again within the cooldown. */
export async function issueOtp(emailRaw: string): Promise<string> {
  const email = normEmail(emailRaw);
  const existing = await getRec(email);
  if (existing && Date.now() - existing.sentAt < RESEND_MS) {
    throw new Error("A code was just sent — wait a minute before requesting another.");
  }
  const code = String(randomInt(0, 1000000)).padStart(6, "0");
  await setRec({ email, hash: hash(email, code), expires: Date.now() + TTL_MS, attempts: 0, sentAt: Date.now() });
  return code;
}

export async function verifyOtp(emailRaw: string, code: string): Promise<{ ok: boolean; reason?: string }> {
  const email = normEmail(emailRaw);
  const entry = await getRec(email);
  if (!entry) return { ok: false, reason: "No code was requested for this email. Request a new one." };
  if (Date.now() > entry.expires) {
    await delRec(email);
    return { ok: false, reason: "Code expired. Request a new one." };
  }
  if (entry.attempts >= MAX_ATTEMPTS) {
    await delRec(email);
    return { ok: false, reason: "Too many attempts. Request a new code." };
  }
  if (entry.hash !== hash(email, String(code).trim())) {
    entry.attempts += 1;
    if (usingSupabase()) await dbBumpOtpAttempts(email, entry.attempts);
    return { ok: false, reason: "Incorrect code." };
  }
  await delRec(email);
  return { ok: true };
}
