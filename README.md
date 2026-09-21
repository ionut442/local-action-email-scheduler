# LocalAction Email Scheduler

Private admin tool for LocalAction. Imports business email addresses from CSV and sends ~25–30 outreach emails per day via SMTP, with a master ON/OFF switch, daily limit, unsubscribe handling, and send logs.

## What it does

- **Dashboard** — pending / sent today / sent total / failed / unsubscribed, sending state, recent activity, "Run scheduler now".
- **Contacts** — CSV import (validation, dedupe, never reactivates unsubscribed), search, status filter, pagination, retry failed.
- **Email** — single template or Variant Experiment (5 subjects × 5 bodies, balanced rotation, global signature, live previews, combination test-send).
- **Results** — subject / body / combination reply-rate tables + 5×5 matrix (replies are the metric; no open/click tracking).
- **Replies** — automatic IMAP reply detection matched to exact sends, manual classification.
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
| `IMAP_HOST` | IMAP hostname for reply monitoring (optional) |
| `IMAP_PORT` | IMAP port (`993` default when secure) |
| `IMAP_SECURE` | `true` (TLS) |
| `IMAP_USER` | IMAP login (can be the same mailbox) |
| `IMAP_PASSWORD` | IMAP password (**never commit**) |

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

- ORM: Drizzle (`src/db/schema.ts`). Migration SQL: `drizzle/0001_init.sql` … `0004_experiment.sql`.
- Apply: `npm run db:migrate` (runs all `drizzle/*.sql` against `DATABASE_URL`), or `npm run db:push`.
- Seed the experiment campaign once: `npm run db:seed` (creates "Product Research Campaign" + 5 subjects + 5 placeholder bodies, sets signature + sender name; never duplicates).
- The app also runs idempotent `CREATE TABLE IF NOT EXISTS` on first DB access, so a fresh Neon DB works even if migrations were skipped.
- `contacts.email` is unique, emails stored lowercase; `unsubscribe_token` unique per contact. Contacts carry optional `trade` plus persisted `subject_variant_id` / `body_variant_id`.
- `email_settings` single row (`id=1`): `sending_enabled=false`, `daily_limit=30` by default, plus the global signature.
- `email_campaigns` / `email_subject_variants` / `email_body_variants` hold the experiment; `email_logs` stores campaign + variant IDs/labels plus subject/body snapshots per send; `inbound_replies` stores matched replies (`inbound_message_id` unique); `imap_state` holds the IMAP UID cursor.

## CSV import

Expected columns (only `email` required):

```
business_name,trade,email,website,phone,google_maps_url,city,country
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

> **Cron trigger (already set up):** Vercel only allows once-daily cron schedules on Hobby (sub-daily needs Pro), so the 15-minute tick comes from a free **Cloudflare Worker** in `cloudflare-cron/` (deployed as `local-action-email-pinger`, schedule `*/15 * * * *`). It pings `GET /api/cron/send?secret=CRON_SECRET` — the endpoint enforces the daily cap and spacing, so the worker is a dumb trigger. If you ever move to Vercel Pro, you can drop the worker and set `vercel.json` to `"schedule": "*/15 * * * *"`. The dashboard "Run scheduler now" button also sends a single due email per click using the same logic.

## Experiment (variant rotation)

- Email page → Variant Experiment: edit S1–S5 subjects and B1–B5 HTML bodies (labels, content, on/off), global signature, live previews, combination test-send. No deploy needed to edit copy.
- Rotation is balanced least-used-combination: every active S×B pair sends equally often (25 combos → each ×4 per 100 sends), random tie-break. Assignment is stored on the contact, so failures/retries keep the same pair.
- Every send logs campaign + variant IDs/labels + immutable snapshots. Bodies support `{{business_name}}` `{{trade}}` `{{email}}` `{{website}}` `{{city}}` `{{country}}` (HTML-escaped in HTML bodies); the signature is auto-appended with a plain-text fallback generated automatically.
- No open/click tracking, no pixels, no link rewriting.

## Reply tracking (IMAP)

- Set the `IMAP_*` env vars, then Settings → "Test IMAP connection". The Cloudflare worker (`cloudflare-cron/`) also pings `GET /api/cron/replies` every 15 min; first sync establishes a UID baseline (imports nothing), "Backfill 30 days" pulls recent history explicitly.
- Matching: `In-Reply-To`/`References` vs stored SMTP Message-ID first, sender-address fallback second (`message_id` / `sender_fallback` / `unmatched` recorded). Duplicates impossible via unique inbound Message-ID. Auto-submitted / precedence / OOO patterns are classified `automatic` and excluded from genuine reply rates.
- Replies page: filters (campaign, variant, classification, search), detail view with the exact original send, manual classification (positive/negative/other/automatic/unclassified).
- Results page: subject, body and S×B combination tables + 5×5 matrix, reply rate = unique replied contacts / sent. Without IMAP configured, sending works normally and reply pages show "not configured".

## Deployment notes

- Push to `main` → Vercel auto-deploys. Set all env vars in the Vercel project (Production + Preview as needed).
- Cron requires a paid Vercel plan for non-daily frequencies; daily works on all plans.
- `sending_enabled` defaults to `false` — enable it in Settings after testing.
