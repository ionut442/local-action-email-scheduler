import { eq } from "drizzle-orm";
import { db, ensureSchema } from "@/db";
import { emailBodyVariants, emailSettings, emailSubjectVariants } from "@/db/schema";
import { getTransporter, safeSmtpError } from "@/lib/mailer";
import { requireAdmin } from "@/lib/require-admin";
import { getSignature } from "@/lib/experiment";
import { renderTemplate, renderTemplateHtml, htmlToText, textToHtml } from "@/lib/template";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Send the current template (or an experiment variant combination) to an
 * arbitrary address. Never touches contacts, logs, or the daily limit.
 */
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let to = "";
  let subjectVariantId = 0;
  let bodyVariantId = 0;
  try {
    const body = (await req.json()) as { to?: string; subjectVariantId?: number; bodyVariantId?: number };
    to = String(body.to ?? "").trim().toLowerCase();
    subjectVariantId = Number(body.subjectVariantId) || 0;
    bodyVariantId = Number(body.bodyVariantId) || 0;
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
      trade: "plumber",
      email: to,
      website: "https://example.com",
      city: "Berlin",
      country: "Germany",
    };

    // Experiment variant combination (with the real global signature), or the
    // legacy single template when no variants are selected.
    let subject: string;
    let bodyHtml: string;
    let bodyText: string;
    if (subjectVariantId > 0 && bodyVariantId > 0) {
      const [ss, bs] = await Promise.all([
        db()
          .select()
          .from(emailSubjectVariants)
          .where(eq(emailSubjectVariants.id, subjectVariantId))
          .limit(1),
        db()
          .select()
          .from(emailBodyVariants)
          .where(eq(emailBodyVariants.id, bodyVariantId))
          .limit(1),
      ]);
      if (!ss[0] || !bs[0]) {
        return Response.json({ error: "Unknown subject/body variant." }, { status: 400 });
      }
      if (!ss[0].subject.trim() || !bs[0].bodyHtml.trim()) {
        return Response.json({ error: "Variant is empty. Save content first." }, { status: 400 });
      }
      const sig = await getSignature();
      subject = `[TEST ${ss[0].label}+${bs[0].label}] ${renderTemplate(ss[0].subject, sample)}`;
      bodyHtml = renderTemplateHtml(`${bs[0].bodyHtml}\n${sig.html}`, sample);
      bodyText = htmlToText(bodyHtml);
    } else {
      if (!settings.subject.trim() || !settings.body.trim()) {
        return Response.json(
          { error: "Template is empty. Save a subject and body first." },
          { status: 400 }
        );
      }
      subject = `[TEST] ${renderTemplate(settings.subject, sample)}`;
      const rendered = renderTemplate(settings.body, sample);
      bodyText = settings.bodyIsHtml ? htmlToText(rendered) : rendered;
      bodyHtml = settings.bodyIsHtml ? rendered : textToHtml(rendered);
    }
    const text =
      `THIS IS A TEST EMAIL. No contact was modified and the daily limit was not affected.\n\n${bodyText}`;
    const html = `<p style="background:#fef3c7;border:1px solid #f59e0b;padding:8px 12px;font-size:13px;"><strong>TEST EMAIL</strong> — no contact was modified and the daily limit was not affected.</p>${bodyHtml}`;

    const fromName = settings.senderName || "Denis Oproiu";
    const fromUser = (process.env.SMTP_USER ?? "").trim();
    const from = fromUser ? `"${fromName}" <${fromUser}>` : fromName;

    const info = await getTransporter().sendMail({ from, to, subject, text, html });
    return Response.json({ ok: true, messageId: info?.messageId ?? null });
  } catch (err) {
    return Response.json({ error: safeSmtpError(err) }, { status: 502 });
  }
}
