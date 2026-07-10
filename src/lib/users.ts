import "server-only";
import { getSheetValues, appendRows, overwriteSheet, ensureSheet } from "./google";
import { cached, invalidate } from "./cache";
import { toRecords } from "./parse";
import {
  usingSupabase, dbListAllowed, dbAddAllowed, dbRemoveAllowed,
  dbRecordLogin, dbListLoginEvents, dbTouch, dbPresence,
} from "./db";

/**
 * User access management. The allowlist and login audit live in the same
 * Google Sheets "database" as everything else (sheets App_Allowed_Emails and
 * App_Login_Events), so no extra infrastructure is required. Admins come from
 * the ADMIN_EMAILS env var and are always allowed.
 */

const ALLOWED_SHEET = "App_Allowed_Emails";
const EVENTS_SHEET = "App_Login_Events";
const ALLOWED_COLS = ["Email", "Role", "Added By", "Added At"];
const EVENT_COLS = ["Email", "Timestamp", "User Agent"];

export type Role = "admin" | "member";

export function normEmail(e: string): string {
  return String(e ?? "").trim().toLowerCase();
}

export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map(normEmail)
    .filter(Boolean);
}

export interface AllowedUser {
  email: string;
  role: Role;
  addedBy: string;
  addedAt: string;
}

export async function listAllowed(): Promise<AllowedUser[]> {
  // hardcoded admins first — always present, cannot be removed via UI
  const out: AllowedUser[] = adminEmails().map((email) => ({
    email, role: "admin" as const, addedBy: "system", addedAt: "",
  }));
  const seen = new Set(out.map((u) => u.email));

  const members: AllowedUser[] = usingSupabase()
    ? ((await dbListAllowed()) as AllowedUser[])
    : await (async () => {
        await ensureSheet(ALLOWED_SHEET, ALLOWED_COLS);
        return cached("users:allowed", 60 * 1000, async () => {
          const recs = toRecords(await getSheetValues(ALLOWED_SHEET));
          return recs.map((r) => ({
            email: normEmail(r["Email"]),
            role: "member" as const,
            addedBy: r["Added By"] ?? "",
            addedAt: r["Added At"] ?? "",
          }));
        });
      })();

  for (const m of members) {
    if (!m.email || seen.has(m.email)) continue;
    seen.add(m.email);
    out.push(m);
  }
  return out;
}

/** Role for an email, or null when access is denied. */
export async function roleFor(email: string): Promise<Role | null> {
  const e = normEmail(email);
  if (adminEmails().includes(e)) return "admin";
  const allowed = await listAllowed();
  return allowed.some((u) => u.email === e) ? "member" : null;
}

export async function addAllowed(email: string, addedBy: string) {
  const e = normEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error("Invalid email address");
  const existing = await listAllowed();
  if (existing.some((u) => u.email === e)) throw new Error("Email already has access");
  if (usingSupabase()) return dbAddAllowed(e, addedBy);
  await appendRows(ALLOWED_SHEET, [[e, "member", addedBy, new Date().toISOString()]]);
  invalidate("users:");
}

export async function removeAllowed(email: string) {
  const e = normEmail(email);
  if (adminEmails().includes(e)) throw new Error("Admins are hardcoded and cannot be removed here");
  if (usingSupabase()) return dbRemoveAllowed(e);
  const recs = toRecords(await getSheetValues(ALLOWED_SHEET));
  const kept = recs.filter((r) => normEmail(r["Email"]) !== e);
  await overwriteSheet(ALLOWED_SHEET, ALLOWED_COLS, kept.map((r) => ALLOWED_COLS.map((c) => r[c] ?? "")));
  invalidate("users:");
}

/* ---------- login audit + activity ---------- */

export async function recordLogin(email: string, userAgent: string) {
  if (usingSupabase()) {
    await dbRecordLogin(normEmail(email), userAgent);
    await touch(email);
    return;
  }
  await ensureSheet(EVENTS_SHEET, EVENT_COLS);
  await appendRows(EVENTS_SHEET, [[normEmail(email), new Date().toISOString(), userAgent.slice(0, 200)]]);
  invalidate("users:events");
  await touch(email);
}

export interface LoginEvent { email: string; timestamp: string; userAgent: string }

export async function listLoginEvents(): Promise<LoginEvent[]> {
  if (usingSupabase()) return dbListLoginEvents();
  await ensureSheet(EVENTS_SHEET, EVENT_COLS);
  return cached("users:events", 60 * 1000, async () => {
    const recs = toRecords(await getSheetValues(EVENTS_SHEET));
    return recs
      .map((r) => ({ email: normEmail(r["Email"]), timestamp: r["Timestamp"] ?? "", userAgent: r["User Agent"] ?? "" }))
      .filter((e) => e.email && e.timestamp)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  });
}

// Presence: Supabase `presence` table in production (serverless-safe);
// in-memory map as the Sheets-only dev fallback.
const lastSeen: Map<string, number> = ((globalThis as Record<string, unknown>).__lastSeen ??=
  new Map()) as Map<string, number>;

export async function touch(email: string) {
  if (usingSupabase()) {
    await dbTouch(normEmail(email));
    return;
  }
  lastSeen.set(normEmail(email), Date.now());
}

/** email → last-seen epoch ms, for the whole user list at once. */
export async function getPresence(): Promise<Map<string, number>> {
  if (usingSupabase()) return dbPresence();
  return new Map(lastSeen);
}

export const ONLINE_WINDOW_MS = 10 * 60 * 1000;
