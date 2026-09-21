import { and, eq } from "drizzle-orm";
import { db, ensureSchema } from "@/db";
import {
  emailBodyVariants,
  emailCampaigns,
  emailLogs,
  emailSubjectVariants,
  inboundReplies,
} from "@/db/schema";

export interface VariantPerformance {
  id: number;
  label: string;
  sent: number;
  repliedContacts: number;
  replyRate: number;
  positiveContacts: number;
  positiveRate: number;
  automaticCount: number;
  inboundTotal: number;
}

export interface ComboPerformance {
  sid: number;
  slab: string;
  bid: number;
  blab: string;
  sent: number;
  repliedContacts: number;
  replyRate: number;
  positiveContacts: number;
  positiveRate: number;
}

export interface CampaignResults {
  campaignId: number;
  totalSent: number;
  repliedContacts: number;
  replyRate: number;
  positiveContacts: number;
  positiveRate: number;
  subjects: VariantPerformance[];
  bodies: VariantPerformance[];
  combos: ComboPerformance[];
}

/**
 * Reply-rate math (§20): one replied contact per original outbound email;
 * unique contacts only; automatic/out-of-office excluded from genuine rates.
 */
export async function getCampaignResults(
  campaignId: number
): Promise<CampaignResults> {
  await ensureSchema();
  const database = db();
  const [subs, bodyVars] = await Promise.all([
    database
      .select()
      .from(emailSubjectVariants)
      .where(eq(emailSubjectVariants.campaignId, campaignId)),
    database
      .select()
      .from(emailBodyVariants)
      .where(eq(emailBodyVariants.campaignId, campaignId)),
  ]);
  const sentLogs = await database
    .select()
    .from(emailLogs)
    .where(
      and(eq(emailLogs.campaignId, campaignId), eq(emailLogs.status, "sent"))
    );
  const replies = await database
    .select()
    .from(inboundReplies)
    .where(eq(inboundReplies.campaignId, campaignId));

  const repliesByLog = new Map<number, typeof replies>();
  for (const r of replies) {
    if (r.emailLogId == null) continue;
    const arr = repliesByLog.get(r.emailLogId) ?? [];
    arr.push(r);
    repliesByLog.set(r.emailLogId, arr);
  }

  const genuine = (rs: typeof replies) =>
    rs.filter((r) => r.classification !== "automatic");
  const isReplied = (logId: number) => genuine(repliesByLog.get(logId) ?? []).length > 0;
  const isPositive = (logId: number) =>
    genuine(repliesByLog.get(logId) ?? []).some((r) => r.classification === "positive");
  const autoCount = (logId: number) =>
    (repliesByLog.get(logId) ?? []).filter((r) => r.classification === "automatic").length;

  const empty = (): VariantPerformance => ({
    id: 0, label: "", sent: 0, repliedContacts: 0, replyRate: 0,
    positiveContacts: 0, positiveRate: 0, automaticCount: 0, inboundTotal: 0,
  });

  const subStats = new Map<number, { perf: VariantPerformance; contacts: Set<number>; pos: Set<number> }>();
  const bodyStats = new Map<number, { perf: VariantPerformance; contacts: Set<number>; pos: Set<number> }>();
  for (const s of subs) subStats.set(s.id, { perf: { ...empty(), id: s.id, label: s.label }, contacts: new Set(), pos: new Set() });
  for (const b of bodyVars) bodyStats.set(b.id, { perf: { ...empty(), id: b.id, label: b.label }, contacts: new Set(), pos: new Set() });

  const comboMap = new Map<string, { sid: number; slab: string; bid: number; blab: string; sent: number; contacts: Set<number>; pos: Set<number>; auto: number; inbound: number }>();
  const allPositive = new Set<number>();

  for (const log of sentLogs) {
    const replied = isReplied(log.id);
    const positive = isPositive(log.id);
    const auto = autoCount(log.id);
    const inbound = (repliesByLog.get(log.id) ?? []).length;
    if (log.contactId != null && positive) allPositive.add(log.contactId);
    if (log.subjectVariantId != null) {
      const e = subStats.get(log.subjectVariantId);
      if (e) {
        e.perf.sent += 1;
        e.perf.automaticCount += auto;
        e.perf.inboundTotal += inbound;
        if (log.contactId != null && replied) e.contacts.add(log.contactId);
        if (log.contactId != null && positive) e.pos.add(log.contactId);
      }
    }
    if (log.bodyVariantId != null) {
      const e = bodyStats.get(log.bodyVariantId);
      if (e) {
        e.perf.sent += 1;
        e.perf.automaticCount += auto;
        e.perf.inboundTotal += inbound;
        if (log.contactId != null && replied) e.contacts.add(log.contactId);
        if (log.contactId != null && positive) e.pos.add(log.contactId);
      }
    }
    if (log.subjectVariantId != null && log.bodyVariantId != null) {
      const key = `${log.subjectVariantId}:${log.bodyVariantId}`;
      let c = comboMap.get(key);
      if (!c) {
        c = {
          sid: log.subjectVariantId,
          slab: log.subjectVariantLabel ?? "",
          bid: log.bodyVariantId,
          blab: log.bodyVariantLabel ?? "",
          sent: 0,
          contacts: new Set(),
          pos: new Set(),
          auto: 0,
          inbound: 0,
        };
        comboMap.set(key, c);
      }
      c.sent += 1;
      c.auto += auto;
      c.inbound += inbound;
      if (log.contactId != null && replied) c.contacts.add(log.contactId);
      if (log.contactId != null && positive) c.pos.add(log.contactId);
    }
  }

  // Unique replied contacts overall.
  const repliedSet = new Set<number>();
  for (const log of sentLogs) {
    if (log.contactId != null && isReplied(log.id)) repliedSet.add(log.contactId);
  }

  const finish = (p: VariantPerformance, contacts: Set<number>, pos: Set<number>) => {
    p.repliedContacts = contacts.size;
    p.replyRate = p.sent > 0 ? (contacts.size / p.sent) * 100 : 0;
    p.positiveContacts = pos.size;
    p.positiveRate = p.sent > 0 ? (pos.size / p.sent) * 100 : 0;
    return p;
  };

  const subjects = [...subStats.values()]
    .map((e) => finish(e.perf, e.contacts, e.pos))
    .sort((a, b) => b.replyRate - a.replyRate);
  const bodies = [...bodyStats.values()]
    .map((e) => finish(e.perf, e.contacts, e.pos))
    .sort((a, b) => b.replyRate - a.replyRate);
  const combos: ComboPerformance[] = [...comboMap.values()]
    .map((c) => ({
      sid: c.sid,
      slab: c.slab,
      bid: c.bid,
      blab: c.blab,
      sent: c.sent,
      repliedContacts: c.contacts.size,
      replyRate: c.sent > 0 ? (c.contacts.size / c.sent) * 100 : 0,
      positiveContacts: c.pos.size,
      positiveRate: c.sent > 0 ? (c.pos.size / c.sent) * 100 : 0,
    }))
    .sort((a, b) => b.replyRate - a.replyRate);

  const totalSent = sentLogs.length;
  return {
    campaignId,
    totalSent,
    repliedContacts: repliedSet.size,
    replyRate: totalSent > 0 ? (repliedSet.size / totalSent) * 100 : 0,
    positiveContacts: allPositive.size,
    positiveRate: totalSent > 0 ? (allPositive.size / totalSent) * 100 : 0,
    subjects,
    bodies,
    combos,
  };
}

export async function getCampaigns() {
  await ensureSchema();
  return db().select().from(emailCampaigns);
}
