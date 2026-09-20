-- LocalAction Email Scheduler initial schema
CREATE TABLE IF NOT EXISTS contacts (
  id SERIAL PRIMARY KEY,
  business_name TEXT,
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
  unsubscribe_token VARCHAR(128) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS email_settings (
  id SERIAL PRIMARY KEY,
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  sender_name TEXT NOT NULL DEFAULT 'LocalAction',
  daily_limit INTEGER NOT NULL DEFAULT 30,
  sending_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS email_logs (
  id SERIAL PRIMARY KEY,
  contact_id INTEGER REFERENCES contacts(id),
  recipient TEXT NOT NULL,
  subject_snapshot TEXT NOT NULL DEFAULT '',
  body_snapshot TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  smtp_message_id TEXT,
  error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS contacts_status_idx ON contacts (status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS contacts_email_idx ON contacts (email);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS email_logs_created_idx ON email_logs (created_at DESC);
