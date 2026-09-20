import { eq } from "drizzle-orm";
import { db, ensureSchema } from "@/db";
import { emailSettings } from "@/db/schema";
import { getTransporter, safeSmtpError } from "@/lib/mailer";
import { requireAdmin } from "@/lib/require-admin";
import { renderTemplate, stripTags, htmlToText, textToHtml } from "@/lib/template";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Send the current template to an arbitrary address.
 * Never touches contacts, logs, or the daily limit.
 */
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let to = "";
  try {
    const body = (await req.json()) as { to?: string };
    to = String(body.to ?? "").trim().toLowerCase();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!EMAIL_RE.test(to)) {
    return Response.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  try {
    await ensureSchema();
    const rows = await db()
      .select()
      .from(emailSettings)
      .where(eq(emailSettings.id, 1))
      .limit(1);
    const settings = rows[0];
    if (!settings || !settings.subject.trim() || !settings.body.trim()) {
      return Response.json(
        { error: "Template is empty. Save a subject and body first." },
        { status: 400 }
      );
    }

    const sample = {
      business_name: "Example Business",
      email: to,
      website: "https://example.com",
      city: "Berlin",
      country: "Germany",
    };
    const subject = `[TEST] ${stripTags(renderTemplate(settings.subject, sample))}`;
    const rendered = renderTemplate(settings.body, sample);
    const bodyText = settings.bodyIsHtml ? htmlToText(rendered) : rendered;
    const bodyHtml = settings.bodyIsHtml ? rendered : textToHtml(rendered);
    const text =
      `THIS IS A TEST EMAIL. No contact was modified and the daily limit was not affected.\n\n${bodyText}`;
    const html = `<p style="background:#fef3c7;border:1px solid #f59e0b;padding:8px 12px;font-size:13px;"><strong>TEST EMAIL</strong> — no contact was modified and the daily limit was not affected.</p>${bodyHtml}`;

    const fromName = settings.senderName || "LocalAction";
    const fromUser = (process.env.SMTP_USER ?? "").trim();
    const from = fromUser ? `"${fromName}" <${fromUser}>` : fromName;

    const info = await getTransporter().sendMail({ from, to, subject, text, html });
    return Response.json({ ok: true, messageId: info?.messageId ?? null });
  } catch (err) {
    return Response.json({ error: safeSmtpError(err) }, { status: 502 });
  }
}
