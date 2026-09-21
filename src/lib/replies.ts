import Imap from "imap";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, ensureSchema } from "@/db";
import {
  contacts,
  emailLogs,
  imapState,
  inboundReplies,
} from "@/db/schema";
import {
  closeImap,
  connectImap,
  getImapConfig,
  openInbox,
  redactImapError,
} from "./imap";

export const REPLY_SNIPPET_MAX = 500;
const FETCH_TEXT_BYTES = 6000;
const MAX_MESSAGES_PER_SYNC = 200;

export type MatchMethod = "message_id" | "sender_fallback" | "unmatched";
export type ReplyClassification =
  | "unclassified"
  | "positive"
  | "negative"
  | "other"
  | "automatic";

export function normalizeMessageId(raw: string | null | undefined): string {
  return (raw ?? "").trim().replace(/^<+|>+$/g, "").trim().toLowerCase();
}

/** Extract a bare email address from a From header value. */
export function extractEmailAddress(from: string | null | undefined): string {
  const raw = (from ?? "").trim();
  if (!raw) return "";
  const bracket = raw.match(/<([^<>@\s]+@[^<>@\s]+)>/);
  if (bracket) return bracket[1].toLowerCase();
  const bare = raw.match(/([^\s<>]+@[^\s<>]+)/);
  return bare ? bare[1].replace(/[.,;:]+$/, "").toLowerCase() : "";
}

const AUTO_SUBJECT_RE =
  /out of office|automatic reply|auto[-\s]?reply|auto[-\s]?respond|delivery (status|failure|notification)|undeliver(ed|able)|mail delivery|vacation|absence|on leave|autoreply/i;

export function isAutomaticReply(input: {
  headers: Record<string, string[] | undefined>;
  subject: string;
  snippet: string;
  fromEmail: string;
}): boolean {
  const h = input.headers;
  const first = (v: string[] | undefined) => (v?.[0] ?? "").trim().toLowerCase();
  const autoSubmitted = first(h["auto-submitted"]);
  if (autoSubmitted && autoSubmitted !== "no") return true;
  const precedence = first(h["precedence"]);
  if (["bulk", "list", "junk", "autorespond"].includes(precedence)) return true;
  if (h["x-autoreply"] || h["x-autorespond"]) return true;
  if (/^(mailer-daemon|postmaster|mail delivery)/i.test(input.fromEmail)) return true;
  if (AUTO_SUBJECT_RE.test(input.subject)) return true;
  if (AUTO_SUBJECT_RE.test(input.snippet.slice(0, 300))) return true;
  return false;
}

export function snippetFromText(raw: string): string {
  // Drop MIME framing lines (boundaries, part headers) so the snippet starts
  // at the actual message text. A boundary is `--` followed by non-space
  // (the `-- ` signature separator is preserved).
  const lines = raw.slice(0, FETCH_TEXT_BYTES * 2).split(/\r?\n/);
  const clean: string[] = [];
  let started = false;
  for (const line of lines) {
    const t = line.trim();
    if (!started) {
      if (!t) continue;
      if (/^--\S/.test(t)) continue;
      if (/^content-(type|transfer-encoding|disposition|id|description|location)\s*:/i.test(t)) continue;
      if (/^this is a multi-part message/i.test(t)) continue;
      started = true;
    } else {
      if (/^--\S/.test(t)) continue;
      if (/^content-(type|transfer-encoding|disposition|id|description|location)\s*:/i.test(t)) continue;
    }
    clean.push(line);
  }
  return clean
    .join("\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, REPLY_SNIPPET_MAX);
}

function imapDate(d: Date): string {
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${d.getUTCDate()}-${months[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}

interface InboundCandidate {
  uid: number;
  messageId: string;
  inReplyTo: string[];
  references: string[];
  fromEmail: string;
  subject: string;
  receivedAt: Date | null;
  headers: Record<string, string[] | undefined>;
  snippet: string;
}

const HEADER_PART =
  "HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID IN-REPLY-TO REFERENCES AUTO-SUBMITTED PRECEDENCE X-AUTOREPLY X-AUTORESPOND)";

function fetchCandidates(imap: Imap, uids: number[]): Promise<InboundCandidate[]> {
  // Note: node-imap wraps each `bodies` entry as BODY.PEEK[<entry>] itself,
  // so entries must be bare section specs (e.g. TEXT) — never pre-wrapped.
  // Byte ranges (TEXT<0.N>) are intentionally not used: node-imap places the
  // range inside the brackets (invalid) and strict servers reject it. The
  // full text part is fetched and truncated client-side instead.
  return fetchCandidatesWith(imap, uids, [HEADER_PART, "TEXT"]);
}

function fetchCandidatesWith(
  imap: Imap,
  uids: number[],
  parts: string[]
): Promise<InboundCandidate[]> {
  return new Promise((resolve, reject) => {
    const out: InboundCandidate[] = [];
    if (uids.length === 0) {
      resolve(out);
      return;
    }
    const fetcher = imap.fetch(uids, {
      bodies: parts,
      struct: false,
    });
    fetcher.on("message", (msg, seqno) => {
      let uid = 0;
      let headerRaw = "";
      let textRaw = "";
      msg.on("attributes", (attrs) => {
        uid = attrs.uid ?? 0;
      });
      msg.on("body", (stream, info) => {
        let buf = "";
        stream.on("data", (chunk: Buffer | string) => {
          buf += chunk.toString("utf8");
        });
        stream.once("end", () => {
          // `which` varies by server (HEADER.FIELDS (...), BODY[TEXT]<0>, …):
          // anything header-like goes to the header buffer, rest is text.
          if (/^header/i.test(info.which)) headerRaw += buf;
          else textRaw += buf;
        });
      });
      msg.once("end", () => {
        try {
          const parsed = Imap.parseHeader(headerRaw) as Record<string, string[] | undefined>;
          const first = (v: string[] | undefined) => v?.[0] ?? "";
          const splitIds = (v: string[] | undefined) =>
            (v ?? [])
              .flatMap((s) => s.split(/\s+/))
              .map(normalizeMessageId)
              .filter(Boolean);
          const fromEmail = extractEmailAddress(first(parsed.from));
          const dateRaw = first(parsed.date);
          const parsed_date = dateRaw ? new Date(dateRaw) : null;
          out.push({
            uid: uid || seqno,
            messageId: normalizeMessageId(first(parsed["message-id"])),
            inReplyTo: splitIds(parsed["in-reply-to"]),
            references: splitIds(parsed.references),
            fromEmail,
            subject: first(parsed.subject).slice(0, 500),
            receivedAt:
              parsed_date && !Number.isNaN(parsed_date.getTime()) ? parsed_date : null,
            headers: parsed,
            snippet: snippetFromText(textRaw),
          });
        } catch {
          /* skip unparseable message */
        }
      });
    });
    fetcher.once("error", reject);
    fetcher.once("end", () => resolve(out));
  });
}

function searchUids(imap: Imap, criteria: unknown[]): Promise<number[]> {
  return new Promise((resolve, reject) => {
    imap.search(criteria as never, (err, results) => {
      if (err) reject(err);
      else resolve((results ?? []).map(Number).filter((n) => Number.isFinite(n)));
    });
  });
}

interface ReplyMatch {
  method: MatchMethod;
  contactId: number | null;
  emailLogId: number | null;
  campaignId: number | null;
}

async function matchCandidate(c: InboundCandidate): Promise<ReplyMatch> {
  const database = db();
  const empty: ReplyMatch = {
    method: "unmatched",
    contactId: null,
    emailLogId: null,
    campaignId: null,
  };
  // First choice: threading headers against stored outbound Message-IDs.
  const threadIds = [...c.inReplyTo, ...c.references];
  for (const id of threadIds) {
    const norm = normalizeMessageId(id);
    if (!norm) continue;
     
    const rows = await database
      .select({
        id: emailLogs.id,
        contactId: emailLogs.contactId,
        campaignId: emailLogs.campaignId,
      })
      .from(emailLogs)
      .where(
        sql`REPLACE(REPLACE(LOWER(${emailLogs.smtpMessageId}), '<', ''), '>', '') = ${norm}`
      )
      .limit(1);
    if (rows[0]) {
      return {
        method: "message_id",
        contactId: rows[0].contactId,
        emailLogId: rows[0].id,
        campaignId: rows[0].campaignId,
      };
    }
  }
  // Fallback: sender address → most recent sent campaign email to that contact.
  if (c.fromEmail) {
     
    const people = await database
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.email, c.fromEmail))
      .limit(1);
    const person = people[0];
    if (person) {
       
      const logs = await database
        .select({ id: emailLogs.id, campaignId: emailLogs.campaignId })
        .from(emailLogs)
        .where(and(eq(emailLogs.contactId, person.id), eq(emailLogs.status, "sent")))
        .orderBy(desc(emailLogs.sentAt))
        .limit(1);
      if (logs[0]) {
        return {
          method: "sender_fallback",
          contactId: person.id,
          emailLogId: logs[0].id,
          campaignId: logs[0].campaignId,
        };
      }
      return {
        method: "unmatched",
        contactId: person.id,
        emailLogId: null,
        campaignId: null,
      };
    }
  }
  return empty;
}

export interface ReplySyncResult {
  ok: boolean;
  reason?: string;
  checked?: number;
  imported?: number;
  matched?: number;
  automatic?: number;
  unmatched?: number;
  cursorUid?: number | null;
  error?: string;
}

export async function syncReplies(opts?: {
  backfillDays?: number;
}): Promise<ReplySyncResult> {
  await ensureSchema();
  const cfg = getImapConfig();
  if (!cfg) {
    return {
      ok: false,
      reason: "imap_not_configured",
      error:
        "IMAP is not configured. Set IMAP_HOST, IMAP_USER and IMAP_PASSWORD in environment variables.",
    };
  }
  const database = db();
  let imap: Imap | null = null;
  try {
    imap = await connectImap(cfg);
    const { uidvalidity } = await openInbox(imap, true);
    const uidval = String(uidvalidity);

    const stateRows = await database
      .select()
      .from(imapState)
      .where(eq(imapState.id, 1))
      .limit(1);
    const state = stateRows[0] ?? null;
    const cursorValid = state && state.uidvalidity === uidval && state.lastUid;
    const backfillDays =
      opts?.backfillDays && opts.backfillDays > 0
        ? Math.min(365, Math.floor(opts.backfillDays))
        : 0;

    let uids: number[];
    if (backfillDays > 0) {
      const since = new Date(Date.now() - backfillDays * 86400000);
      uids = await searchUids(imap, ["SINCE", imapDate(since)]);
    } else if (cursorValid && state?.lastUid) {
      uids = await searchUids(imap, [["UID", `${Number(state.lastUid) + 1}:*`]]);
    } else {
      // Safest first run: establish the current UID as baseline, import nothing.
      const all = await searchUids(imap, ["ALL"]);
      const maxUid = all.length > 0 ? Math.max(...all) : 0;
      await database
        .insert(imapState)
        .values({ id: 1, uidvalidity: uidval, lastUid: String(maxUid), lastSyncAt: new Date(), lastError: null })
        .onConflictDoUpdate({
          target: imapState.id,
          set: { uidvalidity: uidval, lastUid: String(maxUid), lastSyncAt: new Date(), lastError: null },
        });
      return {
        ok: true,
        reason: "baseline_established",
        checked: 0,
        imported: 0,
        matched: 0,
        automatic: 0,
        unmatched: 0,
        cursorUid: maxUid,
      };
    }

    uids = [...new Set(uids)].sort((a, b) => a - b).slice(0, MAX_MESSAGES_PER_SYNC);
    if (uids.length === 0) {
      await database
        .insert(imapState)
        .values({ id: 1, uidvalidity: uidval, lastUid: state?.lastUid ?? "0", lastSyncAt: new Date(), lastError: null })
        .onConflictDoUpdate({
          target: imapState.id,
          set: { uidvalidity: uidval, lastSyncAt: new Date(), lastError: null },
        });
      return {
        ok: true,
        checked: 0,
        imported: 0,
        matched: 0,
        automatic: 0,
        unmatched: 0,
        cursorUid: state?.lastUid ? Number(state.lastUid) : null,
      };
    }

    const candidates = await fetchCandidates(imap, uids);
    let imported = 0;
    let matched = 0;
    let automatic = 0;
    let unmatched = 0;
    let maxUid = uids[uids.length - 1];

    for (const c of candidates) {
      maxUid = Math.max(maxUid, c.uid);
      const inboundId =
        c.messageId || `no-id-${uidval}-${c.uid}`;
      const classification: ReplyClassification = isAutomaticReply({
        headers: c.headers,
        subject: c.subject,
        snippet: c.snippet,
        fromEmail: c.fromEmail,
      })
        ? "automatic"
        : "unclassified";
       
      const match = await matchCandidate(c);
       
      const inserted = await database
        .insert(inboundReplies)
        .values({
          contactId: match.contactId,
          emailLogId: match.emailLogId,
          campaignId: match.campaignId,
          inboundMessageId: inboundId,
          fromEmail: c.fromEmail || "(unknown)",
          subject: c.subject,
          receivedAt: c.receivedAt,
          matchMethod: match.method,
          snippet: c.snippet,
          classification,
        })
        .onConflictDoNothing({ target: inboundReplies.inboundMessageId });
      const rowCount = Number(
        (inserted as unknown as { rowCount?: number }).rowCount ?? 0
      );
      if (rowCount > 0) {
        imported += 1;
        if (match.method !== "unmatched") matched += 1;
        else unmatched += 1;
        if (classification === "automatic") automatic += 1;
      }
    }

    await database
      .insert(imapState)
      .values({ id: 1, uidvalidity: uidval, lastUid: String(maxUid), lastSyncAt: new Date(), lastError: null })
      .onConflictDoUpdate({
        target: imapState.id,
        set: { uidvalidity: uidval, lastUid: String(maxUid), lastSyncAt: new Date(), lastError: null },
      });

    return {
      ok: true,
      checked: candidates.length,
      imported,
      matched,
      automatic,
      unmatched,
      cursorUid: maxUid,
    };
  } catch (err) {
    const message = redactImapError(err);
    try {
      await db()
        .insert(imapState)
        .values({ id: 1, lastSyncAt: new Date(), lastError: message })
        .onConflictDoUpdate({
          target: imapState.id,
          set: { lastSyncAt: new Date(), lastError: message },
        });
    } catch {
      /* ignore bookkeeping failure */
    }
    return { ok: false, error: message };
  } finally {
    if (imap) closeImap(imap);
  }
}

export async function getImapStatus(): Promise<{
  configured: boolean;
  uidvalidity?: string | null;
  lastUid?: string | null;
  lastSyncAt?: Date | string | null;
  lastError?: string | null;
  replyCount?: number;
}> {
  await ensureSchema();
  const database = db();
  const rows = await database
    .select()
    .from(imapState)
    .where(eq(imapState.id, 1))
    .limit(1);
  const state = rows[0] ?? null;
  let replyCount = 0;
  try {
    const c = await database
      .select({ n: sql<number>`COUNT(*)` })
      .from(inboundReplies);
    replyCount = Number(c[0]?.n ?? 0);
  } catch {
    /* ignore */
  }
  return {
    configured: getImapConfig() !== null,
    uidvalidity: state?.uidvalidity ?? null,
    lastUid: state?.lastUid ?? null,
    lastSyncAt: state?.lastSyncAt ?? null,
    lastError: state?.lastError ?? null,
    replyCount,
  };
}
