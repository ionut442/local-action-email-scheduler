-- Experiment system: campaigns, variants, trade, reply tracking.
-- All statements are idempotent and existing data is preserved.

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS trade TEXT;
--> statement-breakpoint
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS subject_variant_id INTEGER;
--> statement-breakpoint
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS body_variant_id INTEGER;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS email_campaigns (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'single',
  active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS email_subject_variants (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS email_body_variants (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  body_html TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS campaign_id INTEGER REFERENCES email_campaigns(id);
--> statement-breakpoint
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS subject_variant_id INTEGER;
--> statement-breakpoint
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS subject_variant_label TEXT;
--> statement-breakpoint
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS body_variant_id INTEGER;
--> statement-breakpoint
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS body_variant_label TEXT;
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS imap_state (
  id INTEGER PRIMARY KEY,
  uidvalidity TEXT,
  last_uid TEXT,
  last_sync_at TIMESTAMPTZ,
  last_error TEXT
);
--> statement-breakpoint
ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS signature_html TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS signature_text TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE email_settings ALTER COLUMN sender_name SET DEFAULT 'Denis Oproiu';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS email_logs_campaign_idx ON email_logs (campaign_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS inbound_replies_contact_idx ON inbound_replies (contact_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS inbound_replies_log_idx ON inbound_replies (email_log_id);
