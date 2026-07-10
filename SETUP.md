# Setup: OTP emails + Supabase

Everything below is already wired in the code — these are the only manual steps,
and each takes a few minutes. Both are optional and independent: the app runs on
Google Sheets with console-printed OTP codes until you complete them.

## 1 · Real OTP emails (Gmail SMTP)

1. Use any Gmail account (a dedicated one like `vibrant.console@gmail.com` is tidier).
2. Enable **2-Step Verification** on it: myaccount.google.com → Security.
3. Create an **App Password**: myaccount.google.com/apppasswords → name it
   "Vibrant Console" → copy the 16-character password.
4. Fill in `web/.env.local`:

   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=yourgmail@gmail.com
   SMTP_PASS=abcd efgh ijkl mnop        ← the app password (spaces are fine)
   SMTP_FROM=Vibrant Console <yourgmail@gmail.com>
   ```

5. Restart the dev server. Login codes now arrive by email; the console
   fallback disappears automatically.

Also set the second admin in `ADMIN_EMAILS` (currently a placeholder).

> Gmail app passwords allow ~500 emails/day — far beyond what OTP login needs.
> Any other SMTP provider (Resend, Brevo, SES) works with the same five vars.

## 2 · Supabase (Postgres database)

1. Create a free project at **supabase.com** (choose a region near you, e.g. Mumbai).
2. In the dashboard: **SQL Editor → New query** → paste the entire contents of
   `web/supabase/schema.sql` → **Run**. This creates all 14 tables.
3. **Project Settings → API**: copy
   - *Project URL* → `SUPABASE_URL`
   - *service_role secret* → `SUPABASE_SERVICE_ROLE_KEY`
   into `web/.env.local`. (The service-role key stays server-side only — it is
   never sent to the browser.)
4. Copy the data across (one command, safe to re-run):

   ```bash
   cd web
   node scripts/migrate-to-supabase.mjs
   ```

5. Restart the dev server. **That's the cutover** — the moment `SUPABASE_URL`
   is set, every read and write (dashboards, uploads, checklists, change logs,
   user allowlist, login audit) goes to Postgres. Clear the env vars to fall
   back to Sheets.

After cutover the Google Sheet is a frozen archive — the app no longer writes
to it. Expect the ads dashboard's first load to drop from ~9s to well under a
second, since date filtering now happens in SQL instead of downloading 100k+
rows.

**Free-tier notes:** 500 MB database (years of headroom at current volume),
but projects **pause after 7 days without traffic** — daily use keeps it alive,
or just hit "Restore" in the dashboard. No automatic backups on free; the
migration script doubles as a re-seeder if you keep uploading to Sheets, and
`pg_dump` works if you want periodic snapshots.
