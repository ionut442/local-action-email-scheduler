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
CREATE TABLE IF NOT EXISTS email_settings (
  id SERIAL PRIMARY KEY,
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  sender_name TEXT NOT NULL DEFAULT 'LocalAction',
  daily_limit INTEGER NOT NULL DEFAULT 30,
  sending_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  next_send_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
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
CREATE INDEX IF NOT EXISTS contacts_status_idx ON contacts (status);
CREATE INDEX IF NOT EXISTS contacts_email_idx ON contacts (email);
CREATE INDEX IF NOT EXISTS email_logs_created_idx ON email_logs (created_at DESC);
ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS next_send_at TIMESTAMPTZ;
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
