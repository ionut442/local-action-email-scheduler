import { and, asc, count, eq } from "drizzle-orm";
import { db, ensureSchema } from "@/db";
import {
  contacts,
  emailBodyVariants,
  emailCampaigns,
  emailLogs,
  emailSettings,
  emailSubjectVariants,
  type EmailBodyVariant,
  type EmailCampaign,
  type EmailSubjectVariant,
} from "@/db/schema";

export interface ActiveExperiment {
  campaign: EmailCampaign;
  subjects: EmailSubjectVariant[];
  bodies: EmailBodyVariant[];
}

export interface VariantPair {
  subject: EmailSubjectVariant;
  body: EmailBodyVariant;
}

export const DEFAULT_SIGNATURE_HTML = `<p>
Denis Oproiu<br>
Product Designer<br>
<a href="https://local-action.com">local-action.com</a>
</p>`;

export const DEFAULT_SIGNATURE_TEXT = `Denis Oproiu
Product Designer
local-action.com`;

/** The currently active campaign with its enabled variants, if any. */
export async function getActiveCampaign(): Promise<{
  campaign: EmailCampaign | null;
  subjects: EmailSubjectVariant[];
  bodies: EmailBodyVariant[];
  experiment: ActiveExperiment | null;
}> {
  await ensureSchema();
  const database = db();
  const campaigns = await database
    .select()
    .from(emailCampaigns)
    .where(eq(emailCampaigns.active, true))
    .limit(1);
  const campaign = campaigns[0] ?? null;
  if (!campaign) return { campaign: null, subjects: [], bodies: [], experiment: null };
  const subjects = await database
    .select()
    .from(emailSubjectVariants)
    .where(
      and(
        eq(emailSubjectVariants.campaignId, campaign.id),
        eq(emailSubjectVariants.enabled, true)
      )
    )
    .orderBy(asc(emailSubjectVariants.sortOrder), asc(emailSubjectVariants.id));
  const bodies = await database
    .select()
    .from(emailBodyVariants)
    .where(
      and(
        eq(emailBodyVariants.campaignId, campaign.id),
        eq(emailBodyVariants.enabled, true)
      )
    )
    .orderBy(asc(emailBodyVariants.sortOrder), asc(emailBodyVariants.id));
  const experiment =
    campaign.mode === "experiment" && subjects.length > 0 && bodies.length > 0
      ? { campaign, subjects, bodies }
      : null;
  return { campaign, subjects, bodies, experiment };
}

/**
 * Pure balanced-assignment core: given every active combination and how many
 * times each was already sent, pick one of the least-used combinations with a
 * random tie-break. Over N sends this deals every combination equally often
 * (e.g. 25 combos × 4 = 100 sends → each exactly 4), while the random
 * tie-break keeps ordering unpredictable.
 */
export function pickLeastUsedCombo<T extends { key: string }>(
  combos: T[],
  sentCounts: Map<string, number>,
  random: () => number = Math.random
): T | null {
  if (combos.length === 0) return null;
  let min = Infinity;
  for (const c of combos) {
    const n = sentCounts.get(c.key) ?? 0;
    if (n < min) min = n;
  }
  const candidates = combos.filter((c) => (sentCounts.get(c.key) ?? 0) === min);
  return candidates[Math.floor(random() * candidates.length)] ?? null;
}

/** Sent counts per combination for a campaign (status='sent' only). */
export async function getComboSentCounts(
  campaignId: number
): Promise<Map<string, number>> {
  const database = db();
  const rows = await database
    .select({
      sid: emailLogs.subjectVariantId,
      bid: emailLogs.bodyVariantId,
      n: count(),
    })
    .from(emailLogs)
    .where(
      and(eq(emailLogs.campaignId, campaignId), eq(emailLogs.status, "sent"))
    )
    .groupBy(emailLogs.subjectVariantId, emailLogs.bodyVariantId);
  const map = new Map<string, number>();
  for (const r of rows) {
    if (r.sid == null || r.bid == null) continue;
    map.set(`${r.sid}:${r.bid}`, Number(r.n));
  }
  return map;
}

/** Choose the next balanced subject/body pair for an experiment. */
export async function pickVariantPair(
  experiment: ActiveExperiment
): Promise<VariantPair | null> {
  const combos: { key: string; subject: EmailSubjectVariant; body: EmailBodyVariant }[] = [];
  for (const subject of experiment.subjects) {
    for (const body of experiment.bodies) {
      combos.push({ key: `${subject.id}:${body.id}`, subject, body });
    }
  }
  const counts = await getComboSentCounts(experiment.campaign.id);
  const picked = pickLeastUsedCombo(combos, counts);
  return picked ? { subject: picked.subject, body: picked.body } : null;
}

/**
 * Resolve the variant pair for a contact, persisting the assignment on the
 * contact row. A contact that already has variant IDs keeps them (retry
 * safety — even if a variant was since disabled) as long as those variants
 * still exist in the same campaign; otherwise a fresh balanced pair is
 * assigned from the currently enabled variants and stored.
 */
export async function resolveContactVariants(
  contact: typeof contacts.$inferSelect,
  experiment: ActiveExperiment
): Promise<VariantPair | null> {
  const database = db();
  if (contact.subjectVariantId != null && contact.bodyVariantId != null) {
    const [ss, bs] = await Promise.all([
      database
        .select()
        .from(emailSubjectVariants)
        .where(eq(emailSubjectVariants.id, contact.subjectVariantId))
        .limit(1),
      database
        .select()
        .from(emailBodyVariants)
        .where(eq(emailBodyVariants.id, contact.bodyVariantId))
        .limit(1),
    ]);
    const subject = ss[0];
    const body = bs[0];
    if (
      subject &&
      body &&
      subject.campaignId === experiment.campaign.id &&
      body.campaignId === experiment.campaign.id
    ) {
      return { subject, body };
    }
  }
  const pair = await pickVariantPair(experiment);
  if (!pair) return null;
  await database
    .update(contacts)
    .set({
      subjectVariantId: pair.subject.id,
      bodyVariantId: pair.body.id,
      updatedAt: new Date(),
    })
    .where(eq(contacts.id, contact.id));
  return pair;
}

/** Per-variant sent counts (for the distribution display). */
export async function getVariantDistribution(campaignId: number): Promise<{
  subjects: { id: number; label: string; sent: number }[];
  bodies: { id: number; label: string; sent: number }[];
  combos: { sid: number; bid: number; sent: number }[];
  totalSent: number;
}> {
  const database = db();
  const [subs, bodies] = await Promise.all([
    database
      .select()
      .from(emailSubjectVariants)
      .where(eq(emailSubjectVariants.campaignId, campaignId))
      .orderBy(asc(emailSubjectVariants.sortOrder), asc(emailSubjectVariants.id)),
    database
      .select()
      .from(emailBodyVariants)
      .where(eq(emailBodyVariants.campaignId, campaignId))
      .orderBy(asc(emailBodyVariants.sortOrder), asc(emailBodyVariants.id)),
  ]);
  const rows = await database
    .select({
      sid: emailLogs.subjectVariantId,
      bid: emailLogs.bodyVariantId,
      n: count(),
    })
    .from(emailLogs)
    .where(
      and(eq(emailLogs.campaignId, campaignId), eq(emailLogs.status, "sent"))
    )
    .groupBy(emailLogs.subjectVariantId, emailLogs.bodyVariantId);
  const bySubject = new Map<number, number>();
  const byBody = new Map<number, number>();
  const combos: { sid: number; bid: number; sent: number }[] = [];
  let totalSent = 0;
  for (const r of rows) {
    const n = Number(r.n);
    totalSent += n;
    if (r.sid != null && r.bid != null) combos.push({ sid: r.sid, bid: r.bid, sent: n });
    if (r.sid != null) bySubject.set(r.sid, (bySubject.get(r.sid) ?? 0) + n);
    if (r.bid != null) byBody.set(r.bid, (byBody.get(r.bid) ?? 0) + n);
  }
  return {
    subjects: subs.map((s) => ({ id: s.id, label: s.label, sent: bySubject.get(s.id) ?? 0 })),
    bodies: bodies.map((b) => ({ id: b.id, label: b.label, sent: byBody.get(b.id) ?? 0 })),
    combos,
    totalSent,
  };
}

export async function getSignature(): Promise<{ html: string; text: string }> {
  await ensureSchema();
  const rows = await db()
    .select({
      html: emailSettings.signatureHtml,
      text: emailSettings.signatureText,
    })
    .from(emailSettings)
    .where(eq(emailSettings.id, 1))
    .limit(1);
  return {
    html: rows[0]?.html || DEFAULT_SIGNATURE_HTML,
    text: rows[0]?.text || DEFAULT_SIGNATURE_TEXT,
  };
}
