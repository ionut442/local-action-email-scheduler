# LocalAction Email Scheduler

Private admin tool for LocalAction. Imports business email addresses from CSV and sends ~25–30 outreach emails per day via SMTP, with a master ON/OFF switch, daily limit, unsubscribe handling, and send logs.

## What it does

- **Dashboard** — pending / sent today / sent total / failed / unsubscribed, sending state, recent activity, "Run scheduler now".
- **Contacts** — CSV import (validation, dedupe, never reactivates unsubscribed), search, status filter, pagination, retry failed.
- **Email** — edit sender name / subject / body with placeholders + live preview, send test emails.
- **Activity** — send logs (sent/failed filter); template snapshots preserved per email.
- **Settings** — master sending switch, daily limit, sender name.

## Environment variables

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string (Vercel integration) |
| `SMTP_HOST` | `mail.local-action.com` |
| `SMTP_PORT` | `465` |
| `SMTP_SECURE` | `true` |
| `SMTP_USER` | `denis@local-action.com` |
| `SMTP_PASSWORD` | SMTP password (**never commit**) |
| `MAIL_FROM_NAME` | Default From name (`LocalAction`) |
| `ADMIN_PASSWORD` | Password for `/login` |
| `AUTH_SECRET` | Secret signing the session cookie (`openssl rand -hex 32`) |
| `CRON_SECRET` | Protects `/api/cron/send` (`openssl rand -hex 32`) |
| `APP_URL` | Public URL, e.g. `https://your-app.vercel.app` (unsubscribe links) |

See `.env.example`. SMTP credentials live only in env vars — never in the UI or repo.

## Local development

```bash
npm install
cp .env.example .env.local   # then fill in real values
npm run db:migrate            # create tables (needs DATABASE_URL)
npm run dev                   # http://localhost:3000
```

Other commands: `npm run lint`, `npx tsc --noEmit`, `npm run build`.

## Database

- ORM: Drizzle (`src/db/schema.ts`). Migration SQL: `drizzle/0001_init.sql`.
- Apply: `npm run db:migrate` (runs all `drizzle/*.sql` against `DATABASE_URL`), or `npm run db:push`.
- The app also runs idempotent `CREATE TABLE IF NOT EXISTS` on first DB access, so a fresh Neon DB works even if migrations were skipped.
- `contacts.email` is unique, emails stored lowercase; `unsubscribe_token` unique per contact.
- `email_settings` single row (`id=1`): `sending_enabled=false`, `daily_limit=30` by default.
- `email_logs` stores subject/body snapshots per send.

## CSV import

Expected columns (only `email` required):

```
business_name,email,website,phone,google_maps_url,city,country
```

Rules: trim values, lowercase emails, validate format, skip duplicates (including within the file), never reactivate `unsubscribed`, never overwrite `sent`. Returns a summary (`found / imported / duplicates / invalid`). A template is downloadable on the Contacts page. No scraping — you supply the CSV.

## Vercel cron

`vercel.json` registers `GET /api/cron/send` on a daily schedule (`0 9 * * *`) as a fallback heartbeat. Auth: `Authorization: Bearer $CRON_SECRET` (Vercel sends this automatically when `CRON_SECRET` is set), `x-cron-secret` header, or `?secret=`. Logic (`src/lib/scheduler.ts`) is frequency-independent: it counts today's successful sends from `email_logs`, caps at `daily_limit`, selects `pending` only, claims via `processing` state, sends sequentially (Node runtime, fully awaited), recovers stale `processing` rows after 30 min, and never resends `sent`/`unsubscribed`. "Run scheduler now" calls the same function.

## Send pacing (spaced emails)

Each scheduler run sends **at most one email**, then persists `email_settings.next_send_at`:

```
wait = 1440 / daily_limit  ±  up-to-10-min random jitter   (min 1 min)
```

At the default limit of 30 this averages ~48 min between emails (38–58 min with jitter), spreading the quota across ~24h. The dashboard shows the spacing and the next scheduled send. If a run fires before the time is due, it sends nothing (`waiting_interval`).

> **Hobby plan note:** Vercel only allows once-daily cron schedules on Hobby (sub-daily needs Pro), and the built-in daily tick alone would drip just ~1 email/day with pacing active. So for true spaced sending on Hobby, add a **free external cron** (e.g. cron-job.org) pinging the following URL every 15 minutes:
>
> ```
> GET https://local-action-email-scheduler.vercel.app/api/cron/send?secret=YOUR_CRON_SECRET
> ```
>
> (use the `CRON_SECRET` value from your Vercel env vars). The endpoint logic is identical to Vercel Cron — one email per due run, daily cap enforced. Alternative: upgrade the Vercel project to Pro and change `vercel.json` to `"schedule": "*/15 * * * *"`. The dashboard "Run scheduler now" button also sends a single due email per click using the same logic.

## Deployment notes

- Push to `main` → Vercel auto-deploys. Set all env vars in the Vercel project (Production + Preview as needed).
- Cron requires a paid Vercel plan for non-daily frequencies; daily works on all plans.
- `sending_enabled` defaults to `false` — enable it in Settings after testing.
