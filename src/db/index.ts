import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { emailSettings } from "./schema";

let client: ReturnType<typeof getClient> | null = null;

function getClient() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add it to .env.local (local) or Vercel project environment variables."
    );
  }
  const sql = neon(url);
  return drizzle(sql);
}

export function db() {
  if (!client) client = getClient();
  return client;
}

// Idempotent schema bootstrap so a fresh Neon database works even if the
// drizzle migration step was skipped. Safe to call on every DB access.
let ensured = false;

const DDL = `
CREATE TABLE IF NOT EXISTS contacts (
  id SERIAL PRIMARY KEY,
  business_name TEXT,
  trade TEXT,
  email VARCHAR(320) NOT NULL UNIQUE,
  website TEXT,
  phone TEXT,
  google_maps_url TEXT,
  city TEXT,
  country TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  send_attempts INTEGER NOT NULL DEFAULT 0,
  sent_at TIMESTAMPTZ,
  last_error TEXT,
  subject_variant_id INTEGER,
  body_variant_id INTEGER,
  unsubscribe_token VARCHAR(128) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS email_settings (
  id SERIAL PRIMARY KEY,
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  sender_name TEXT NOT NULL DEFAULT 'Denis Oproiu',
  daily_limit INTEGER NOT NULL DEFAULT 30,
  sending_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  body_is_html BOOLEAN NOT NULL DEFAULT FALSE,
  next_send_at TIMESTAMPTZ,
  signature_html TEXT NOT NULL DEFAULT '',
  signature_text TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS email_campaigns (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'single',
  active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS email_subject_variants (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS email_body_variants (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  body_html TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS email_logs (
  id SERIAL PRIMARY KEY,
  contact_id INTEGER REFERENCES contacts(id),
  campaign_id INTEGER REFERENCES email_campaigns(id),
  subject_variant_id INTEGER,
  subject_variant_label TEXT,
  body_variant_id INTEGER,
  body_variant_label TEXT,
  recipient TEXT NOT NULL,
  subject_snapshot TEXT NOT NULL DEFAULT '',
  body_snapshot TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  smtp_message_id TEXT,
  error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS inbound_replies (
  id SERIAL PRIMARY KEY,
  contact_id INTEGER REFERENCES contacts(id),
  email_log_id INTEGER REFERENCES email_logs(id),
  campaign_id INTEGER REFERENCES email_campaigns(id),
  inbound_message_id TEXT NOT NULL UNIQUE,
  from_email TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  received_at TIMESTAMPTZ,
  match_method TEXT NOT NULL,
  snippet TEXT NOT NULL DEFAULT '',
  classification TEXT NOT NULL DEFAULT 'unclassified',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS imap_state (
  id INTEGER PRIMARY KEY,
  uidvalidity TEXT,
  last_uid TEXT,
  last_sync_at TIMESTAMPTZ,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS contacts_status_idx ON contacts (status);
CREATE INDEX IF NOT EXISTS contacts_email_idx ON contacts (email);
CREATE INDEX IF NOT EXISTS email_logs_created_idx ON email_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS email_logs_campaign_idx ON email_logs (campaign_id);
CREATE INDEX IF NOT EXISTS inbound_replies_contact_idx ON inbound_replies (contact_id);
CREATE INDEX IF NOT EXISTS inbound_replies_log_idx ON inbound_replies (email_log_id);
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS trade TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS subject_variant_id INTEGER;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS body_variant_id INTEGER;
ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS next_send_at TIMESTAMPTZ;
ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS body_is_html BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS signature_html TEXT NOT NULL DEFAULT '';
ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS signature_text TEXT NOT NULL DEFAULT '';
ALTER TABLE email_settings ALTER COLUMN sender_name SET DEFAULT 'Denis Oproiu';
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS campaign_id INTEGER REFERENCES email_campaigns(id);
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS subject_variant_id INTEGER;
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS subject_variant_label TEXT;
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS body_variant_id INTEGER;
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS body_variant_label TEXT;
`;

export async function ensureSchema() {
  if (ensured) return;
  const database = db();
  // Split on statement boundaries; the DDL contains no semicolons inside literals.
  const statements = DDL.split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) {
     
    await database.execute(stmt);
  }
  await database
    .insert(emailSettings)
    .values({ id: 1 })
    .onConflictDoNothing({ target: emailSettings.id });
  ensured = true;
}
