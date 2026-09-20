import { and, count, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { db, ensureSchema } from "@/db";
import { contacts, emailLogs, emailSettings } from "@/db/schema";
import { getTransporter, safeSmtpError } from "./mailer";
import {
  buildUnsubscribeFooterHtml,
  buildUnsubscribeFooterText,
  renderTemplate,
  textToHtml,
  unsubscribeUrlFor,
} from "./template";

/** Contacts stuck in `processing` longer than this are assumed orphaned by a crashed run. */
export const STALE_PROCESSING_MINUTES = 30;

export interface SchedulerResult {
  ran: boolean;
  reason?: string;
  sent: number;
  failed: number;
  skipped?: number;
  dailyLimit?: number;
  sentToday?: number;
  errors: string[];
}

/**
 * Frequency-independent scheduler: enforces the per-day limit no matter how
 * often it is invoked (daily cron, hourly cron, or manual runs).
 * Sends sequentially with very low concurrency (one SMTP send at a time)
 * and never resends contacts already marked sent or unsubscribed.
 */
export async function runScheduler(): Promise<SchedulerResult> {
  await ensureSchema();
  const database = db();

  const rows = await database
    .select()
    .from(emailSettings)
    .where(eq(emailSettings.id, 1))
    .limit(1);
  const settings = rows[0] ?? {
    subject: "",
    body: "",
    senderName: "LocalAction",
    dailyLimit: 30,
    sendingEnabled: false,
  };

  if (!settings.sendingEnabled) {
    return {
      ran: false,
      reason: "sending_disabled",
      sent: 0,
      failed: 0,
      errors: [],
    };
  }

  const dailyLimit = Math.max(0, settings.dailyLimit ?? 30);

  // Recover orphaned `processing` rows from crashed runs.
  await database
    .update(contacts)
    .set({ status: "pending", updatedAt: new Date() })
    .where(
      and(
        eq(contacts.status, "processing"),
        lt(
          contacts.updatedAt,
          sql`NOW() - (${STALE_PROCESSING_MINUTES} || ' minutes')::INTERVAL`
        )
      )
    );

  // How many successful sends already happened today (UTC day boundary).
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const sentTodayRows = await database
    .select({ n: count() })
    .from(emailLogs)
    .where(
      and(
        eq(emailLogs.status, "sent"),
        sql`${emailLogs.sentAt} >= ${startOfDay}`
      )
    );
  const sentToday = Number(sentTodayRows[0]?.n ?? 0);
  const remaining = dailyLimit - sentToday;
  if (remaining <= 0) {
    return {
      ran: true,
      reason: "daily_limit_reached",
      sent: 0,
      failed: 0,
      dailyLimit,
      sentToday,
      errors: [],
    };
  }

  if (!settings.subject.trim() || !settings.body.trim()) {
    return {
      ran: false,
      reason: "template_missing",
      sent: 0,
      failed: 0,
      dailyLimit,
      sentToday,
      errors: ["Email subject/body template is empty. Set it on the Email page first."],
    };
  }

  // Select pending contacts only, oldest first.
  const batch = await database
    .select()
    .from(contacts)
    .where(eq(contacts.status, "pending"))
    .orderBy(contacts.createdAt)
    .limit(remaining);

  if (batch.length === 0) {
    return {
      ran: true,
      reason: "no_pending",
      sent: 0,
      failed: 0,
      dailyLimit,
      sentToday,
      errors: [],
    };
  }

  // Claim them as `processing` so overlapping invocations don't double-send.
  const ids = batch.map((c) => c.id);
  await database
    .update(contacts)
    .set({ status: "processing", updatedAt: new Date() })
    .where(and(inArray(contacts.id, ids), eq(contacts.status, "pending")));

  // Re-read the claimed rows (an overlapping run may have claimed some).
  const claimed = await database
    .select()
    .from(contacts)
    .where(and(inArray(contacts.id, ids), eq(contacts.status, "processing")));

  const fromName = settings.senderName || "LocalAction";
  const fromUser = (process.env.SMTP_USER ?? "").trim();
  const from = fromUser ? `"${fromName}" <${fromUser}>` : fromName;

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  // Sequential sends: await each SMTP transaction before the next.
  for (const contact of claimed) {
    const vars = {
      business_name: contact.businessName,
      email: contact.email,
      website: contact.website,
      city: contact.city,
      country: contact.country,
    };
    const subject = renderTemplate(settings.subject, vars);
    const textBody = renderTemplate(settings.body, vars);
    const unsubUrl = unsubscribeUrlFor(contact.unsubscribeToken);
    const html = `${textToHtml(textBody)}${buildUnsubscribeFooterHtml(unsubUrl)}`;
    const text = `${textBody}${buildUnsubscribeFooterText(unsubUrl)}`;

    try {
       
      const info = await getTransporter().sendMail({
        from,
        to: contact.email,
        subject,
        text,
        html,
        headers: {
          "List-Unsubscribe": `<${unsubUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });
      const now = new Date();
       
      await database
        .update(contacts)
        .set({
          status: "sent",
          sentAt: now,
          lastError: null,
          sendAttempts: (contact.sendAttempts ?? 0) + 1,
          updatedAt: now,
        })
        .where(eq(contacts.id, contact.id));
       
      await database.insert(emailLogs).values({
        contactId: contact.id,
        recipient: contact.email,
        subjectSnapshot: subject,
        bodySnapshot: textBody,
        status: "sent",
        smtpMessageId:
          typeof info?.messageId === "string" ? info.messageId : null,
        sentAt: now,
      });
      sent += 1;
    } catch (err) {
      const message = safeSmtpError(err);
      const now = new Date();
       
      await database
        .update(contacts)
        .set({
          status: "failed",
          lastError: message,
          sendAttempts: (contact.sendAttempts ?? 0) + 1,
          updatedAt: now,
        })
        .where(eq(contacts.id, contact.id));
       
      await database.insert(emailLogs).values({
        contactId: contact.id,
        recipient: contact.email,
        subjectSnapshot: subject,
        bodySnapshot: textBody,
        status: "failed",
        error: message,
        sentAt: now,
      });
      failed += 1;
      // One failed recipient must not stop the rest; cap collected errors.
      if (errors.length < 10) errors.push(`${contact.email}: ${message}`);
    }
  }

  return {
    ran: true,
    sent,
    failed,
    dailyLimit,
    sentToday,
    errors,
  };
}

export async function getDashboardStats() {
  await ensureSchema();
  const database = db();
  const byStatus = await database
    .select({ status: contacts.status, n: count() })
    .from(contacts)
    .groupBy(contacts.status);
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const sentTodayRows = await database
    .select({ n: count() })
    .from(emailLogs)
    .where(
      and(
        eq(emailLogs.status, "sent"),
        sql`${emailLogs.sentAt} >= ${startOfDay}`
      )
    );
  const sentTotalRows = await database
    .select({ n: count() })
    .from(emailLogs)
    .where(eq(emailLogs.status, "sent"));
  const settingsRows = await database
    .select()
    .from(emailSettings)
    .where(eq(emailSettings.id, 1))
    .limit(1);
  const recent = await database
    .select()
    .from(emailLogs)
    .orderBy(desc(emailLogs.createdAt))
    .limit(10);

  const map: Record<string, number> = {};
  for (const r of byStatus) map[r.status ?? ""] = Number(r.n);
  return {
    pending: map.pending ?? 0,
    processing: map.processing ?? 0,
    sent: map.sent ?? 0,
    failed: map.failed ?? 0,
    unsubscribed: map.unsubscribed ?? 0,
    sentToday: Number(sentTodayRows[0]?.n ?? 0),
    sentTotal: Number(sentTotalRows[0]?.n ?? 0),
    settings: settingsRows[0] ?? null,
    recent,
  };
}
