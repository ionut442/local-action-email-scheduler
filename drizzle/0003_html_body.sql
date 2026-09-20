-- HTML body mode for the email template.
ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS body_is_html BOOLEAN NOT NULL DEFAULT FALSE;
