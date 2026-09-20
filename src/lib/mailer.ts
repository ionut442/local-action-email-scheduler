import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

let transporter: Transporter | null = null;

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}

export function getSmtpConfig(): SmtpConfig {
  const host = (process.env.SMTP_HOST ?? "").trim();
  const user = (process.env.SMTP_USER ?? "").trim();
  const pass = process.env.SMTP_PASSWORD ?? "";
  const port = Number.parseInt(process.env.SMTP_PORT ?? "465", 10);
  const secure =
    (process.env.SMTP_SECURE ?? "true").toLowerCase() !== "false";
  const missing: string[] = [];
  if (!host) missing.push("SMTP_HOST");
  if (!user) missing.push("SMTP_USER");
  if (!pass) missing.push("SMTP_PASSWORD");
  if (!Number.isFinite(port)) missing.push("SMTP_PORT");
  if (missing.length > 0) {
    throw new Error(
      `SMTP is not configured. Missing: ${missing.join(", ")}. Set them in environment variables.`
    );
  }
  return { host, port, secure, user, pass };
}

/** Reusable singleton transport. Sends must be awaited sequentially by callers. */
export function getTransporter(): Transporter {
  if (transporter) return transporter;
  const cfg = getSmtpConfig();
  transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    // Conservative single-connection behaviour; callers send sequentially.
    pool: false,
    maxConnections: 1,
  });
  return transporter;
}

export function resetTransporterForTests() {
  transporter = null;
}

/** Redact any secret-looking values from an error surfaced to the admin UI. */
export function safeSmtpError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const pass = process.env.SMTP_PASSWORD;
  const secret = process.env.CRON_SECRET;
  let out = raw;
  if (pass && out.includes(pass)) out = out.split(pass).join("[redacted]");
  if (secret && out.includes(secret)) out = out.split(secret).join("[redacted]");
  return out.slice(0, 1000);
}
