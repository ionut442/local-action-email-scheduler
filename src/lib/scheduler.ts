import { and, count, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { db, ensureSchema } from "@/db";
import { contacts, emailLogs, emailSettings } from "@/db/schema";
import { getTransporter, safeSmtpError } from "./mailer";
import {
  renderTemplate,
  renderTemplateHtml,
  htmlToText,
  textToHtml,
  unsubscribeUrlFor,
} from "./template";
import {
  getActiveCampaign,
  getSignature,
  resolveContactVariants,
  type ActiveExperiment,
} from "./experiment";

/** Contacts stuck in `processing` longer than this are assumed orphaned by a crashed run. */
export const STALE_PROCESSING_MINUTES = 30;

/** Random spacing jitter applied to the send interval, in minutes. */
export const MAX_JITTER_MINUTES = 10;

export interface SchedulerResult {
  ran: boolean;
  reason?: string;
  sent: number;
  failed: number;
  skipped?: number;
  dailyLimit?: number;
  sentToday?: number;
  /** ISO timestamp of the earliest next send (pacing). */
  nextSendAt?: string | null;
  errors: string[];
}

/**
 * Weekend pause: no automatic or manual sends on Saturday/Sunday (UTC).
 * Monday's first run resumes naturally since the pacing timestamp is then
 * in the past.
 */
export function isWeekend(date: Date = new Date()): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

/**
 * Next send time = now + (1440 / dailyLimit) ± up-to-10-min jitter.
 * Spreads the daily quota across ~24h so emails go out ~48 min apart
 * (at the default limit of 30) instead of in one burst.
 */
export function computeNextSendAt(from: Date, dailyLimit: number): Date {
  const base = 1440 / Math.max(1, dailyLimit);
  const jitter = (Math.random() * 2 - 1) * MAX_JITTER_MINUTES;
  const waitMin = Math.max(1, base + jitter);
  return new Date(from.getTime() + waitMin * 60_000);
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
    senderName: "Denis Oproiu",
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

  if (isWeekend()) {
    return {
      ran: false,
      reason: "weekend_pause",
      sent: 0,
      failed: 0,
      errors: [],
    };
  }

  const dailyLimit = Math.max(1, Math.min(500, settings.dailyLimit ?? 30));

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

  // Resolve sending mode first: an active experiment campaign brings its own
  // variants; otherwise the legacy single template is used as a fallback.
  const { campaign, experiment } = await getActiveCampaign();
  let activeExperiment: ActiveExperiment | null = experiment;
  if (activeExperiment) {
    const hasCopy = activeExperiment.subjects.some((s) => s.subject.trim()) &&
      activeExperiment.bodies.some((b) => b.bodyHtml.trim());
    if (!hasCopy) activeExperiment = null;
  }
  const signature = activeExperiment ? await getSignature() : null;

  if (!activeExperiment && (!settings.subject.trim() || !settings.body.trim())) {
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

  // Pacing: at most one email per run, no earlier than the scheduled time.
  // The cron ticks every 15 min; each due run sends a single email, which
  // spreads the daily quota across ~24h (e.g. ~48 min apart at limit 30).
  const now = new Date();
  const scheduled = settings.nextSendAt ? new Date(settings.nextSendAt) : null;
  if (scheduled && now < scheduled) {
    return {
      ran: false,
      reason: "waiting_interval",
      sent: 0,
      failed: 0,
      dailyLimit,
      sentToday,
      nextSendAt: scheduled.toISOString(),
      errors: [],
    };
  }

  // Select pending contacts only, oldest first. One per run (see pacing).
  const batch = await database
    .select()
    .from(contacts)
    .where(eq(contacts.status, "pending"))
    .orderBy(contacts.createdAt)
    .limit(1);

  if (batch.length === 0) {
    return {
      ran: true,
      reason: "no_pending",
      sent: 0,
      failed: 0,
      dailyLimit,
      sentToday,
      nextSendAt: scheduled ? scheduled.toISOString() : null,
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

  const fromName = settings.senderName || "Denis Oproiu";
  const fromUser = (process.env.SMTP_USER ?? "").trim();
  const from = fromUser ? `"${fromName}" <${fromUser}>` : fromName;

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  // Sequential sends: await each SMTP transaction before the next.
  for (const contact of claimed) {
    const vars = {
      business_name: contact.businessName,
      trade: contact.trade,
      email: contact.email,
      website: contact.website,
      city: contact.city,
      country: contact.country,
    };

    // Resolve subject/body: experiment variants (persisted per contact) or
    // the legacy single template.
    let subject: string;
    let html: string;
    let text: string;
    let renderedBody: string;
    const campaignId: number | null = campaign?.id ?? null;
    let sid: number | null = null;
    let slab: string | null = null;
    let bid: number | null = null;
    let blab: string | null = null;

    if (activeExperiment && signature) {
      const pair = await resolveContactVariants(contact, activeExperiment);
      if (!pair) {
         
        await database
          .update(contacts)
          .set({ status: "pending", updatedAt: new Date() })
          .where(eq(contacts.id, contact.id));
        continue;
      }
      sid = pair.subject.id;
      slab = pair.subject.label;
      bid = pair.body.id;
      blab = pair.body.label;
      // Subjects are plain text by authorship: substitute raw values and
      // never strip — a business name containing `<` must survive intact.
      subject = renderTemplate(pair.subject.subject, vars);
      renderedBody = renderTemplateHtml(
        `${pair.body.bodyHtml}\n${signature.html}`,
        vars
      );
      html = renderedBody;
      text = htmlToText(renderedBody);
    } else {
      subject = renderTemplate(settings.subject, vars);
      renderedBody = renderTemplate(settings.body, vars);
      // HTML mode: body is used as-is (admin-authored); plain mode: convert.
      // No visible unsubscribe footer; List-Unsubscribe headers below still
      // give mailbox providers a native opt-out button.
      html = settings.bodyIsHtml ? renderedBody : textToHtml(renderedBody);
      text = settings.bodyIsHtml ? htmlToText(renderedBody) : renderedBody;
    }
    const unsubUrl = unsubscribeUrlFor(contact.unsubscribeToken);

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
        campaignId,
        subjectVariantId: sid,
        subjectVariantLabel: slab,
        bodyVariantId: bid,
        bodyVariantLabel: blab,
        recipient: contact.email,
        subjectSnapshot: subject,
        bodySnapshot: renderedBody,
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
        campaignId,
        subjectVariantId: sid,
        subjectVariantLabel: slab,
        bodyVariantId: bid,
        bodyVariantLabel: blab,
        recipient: contact.email,
        subjectSnapshot: subject,
        bodySnapshot: renderedBody,
        status: "failed",
        error: message,
        sentAt: now,
      });
      failed += 1;
      // One failed recipient must not stop the rest; cap collected errors.
      if (errors.length < 10) errors.push(`${contact.email}: ${message}`);
    }
  }

  // Schedule the next send (interval + jitter), whether this attempt
  // succeeded or failed, so spacing holds even across failures.
  const attempted = sent + failed > 0;
  const next = attempted ? computeNextSendAt(new Date(), dailyLimit) : null;
  if (next) {
    await database
      .update(emailSettings)
      .set({ nextSendAt: next, updatedAt: new Date() })
      .where(eq(emailSettings.id, 1));
  }

  return {
    ran: true,
    sent,
    failed,
    dailyLimit,
    sentToday,
    nextSendAt: next ? next.toISOString() : scheduled ? scheduled.toISOString() : null,
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
