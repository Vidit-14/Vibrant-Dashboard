# Vibrant Commerce Console

Next.js + TypeScript rebuild of the Streamlit Amazon Ads / ASIN analytics dashboard.
Google Sheets (`Dashboard_data`) remains the data store — same worksheets, same upload
flows, so the Streamlit app and this app can run side by side during the transition.

## Run

```bash
cd web
npm install       # first time only
npm run dev       # http://localhost:3000
```

Production:

```bash
npm run build && npm start
```

## Configuration — `.env.local`

| Var | Purpose |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | gspread service-account email |
| `GOOGLE_PRIVATE_KEY` | service-account private key (`\n`-escaped) |
| `SPREADSHEET_ID` | ID of the `Dashboard_data` spreadsheet |
| `SESSION_SECRET` | random hex string for signing session cookies |
| `ADMIN_EMAILS` | comma-separated admin emails (always allowed, cannot be revoked in UI) |
| `SMTP_HOST/PORT/USER/PASS/FROM` | SMTP for OTP emails (Gmail app password works). Empty → codes print to the server console (dev mode) |

`.env.local` is git-ignored. It was generated from `.streamlit/secrets.toml`.

## Architecture

- **Auth** — invite-only email + OTP login (`/login`): the email must be in
  `ADMIN_EMAILS` or the `App_Allowed_Emails` sheet, then a 6-digit code is
  emailed (10-min expiry, 5 attempts, 60s resend cooldown) and a 7-day HS256
  JWT cookie is issued. `src/proxy.ts` guards every page/API route and gates
  `/admin` + `/api/admin` to the admin role. Logins are audited to the
  `App_Login_Events` sheet; the `/admin` page manages access and shows usage
  stats (last login, login counts, online-now presence via heartbeat).
- **Data layer** — `src/lib/google.ts` (Sheets API v4) + `src/lib/cache.ts` (in-memory
  TTL cache, invalidated after uploads). `src/lib/parse.ts` ports the battle-tested
  Streamlit cleaning: duplicate-header dedupe, ghost-row dropping, currency-string
  coercion, float-ASIN normalisation.
- **API routes** — `src/app/api/**`, thin JSON endpoints per page; uploads are
  multipart and parsed with `xlsx`.
- **Pages** — `src/app/(app)/**`: dashboard (+ `asin/[asin]`, `campaign/[name]`),
  returns, sales-tracker, asin-health (+ `[asin]` checklist), voc.
- **UI** — Tailwind v4 design tokens in `globals.css` (light default, `.dark` theme via
  next-themes), TanStack Table (`DataTable`), Recharts wrappers (`charts.tsx`) following
  a validated, colorblind-safe palette.
