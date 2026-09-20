-- Pacing for spaced sending: earliest time the next email may go out.
ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS next_send_at TIMESTAMPTZ;
