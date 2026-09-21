import {
  pgTable,
  serial,
  text,
  varchar,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";

export const CONTACT_STATUS = [
  "pending",
  "processing",
  "sent",
  "failed",
  "unsubscribed",
] as const;

export type ContactStatus = (typeof CONTACT_STATUS)[number];

export const contacts = pgTable("contacts", {
  id: serial("id").primaryKey(),
  businessName: text("business_name"),
  trade: text("trade"),
  email: varchar("email", { length: 320 }).notNull().unique(),
  website: text("website"),
  phone: text("phone"),
  googleMapsUrl: text("google_maps_url"),
  city: text("city"),
  country: text("country"),
  status: text("status").notNull().default("pending"),
  sendAttempts: integer("send_attempts").notNull().default(0),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  lastError: text("last_error"),
  // Persisted experiment assignment: a contact keeps its Sx + By combo
  // across failures and retries (never re-randomised).
  subjectVariantId: integer("subject_variant_id"),
  bodyVariantId: integer("body_variant_id"),
  unsubscribeToken: varchar("unsubscribe_token", { length: 128 })
    .notNull()
    .unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;

export const emailSettings = pgTable("email_settings", {
  id: serial("id").primaryKey(),
  subject: text("subject").notNull().default(""),
  body: text("body").notNull().default(""),
  senderName: text("sender_name").notNull().default("Denis Oproiu"),
  dailyLimit: integer("daily_limit").notNull().default(30),
  sendingEnabled: boolean("sending_enabled").notNull().default(false),
  // Body format: false = plain text (converted to HTML), true = raw HTML.
  bodyIsHtml: boolean("body_is_html").notNull().default(false),
  // Pacing: earliest time the next email may go out (set after every attempt).
  nextSendAt: timestamp("next_send_at", { withTimezone: true }),
  // Global signature appended to experiment body variants.
  signatureHtml: text("signature_html").notNull().default(""),
  signatureText: text("signature_text").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type EmailSettings = typeof emailSettings.$inferSelect;

export const CAMPAIGN_MODES = ["single", "experiment"] as const;

export const emailCampaigns = pgTable("email_campaigns", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().default(""),
  mode: text("mode").notNull().default("single"),
  active: boolean("active").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type EmailCampaign = typeof emailCampaigns.$inferSelect;

export const emailSubjectVariants = pgTable("email_subject_variants", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id")
    .notNull()
    .references(() => emailCampaigns.id, { onDelete: "cascade" }),
  label: text("label").notNull().default(""),
  subject: text("subject").notNull().default(""),
  enabled: boolean("enabled").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

export type EmailSubjectVariant = typeof emailSubjectVariants.$inferSelect;

export const emailBodyVariants = pgTable("email_body_variants", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id")
    .notNull()
    .references(() => emailCampaigns.id, { onDelete: "cascade" }),
  label: text("label").notNull().default(""),
  bodyHtml: text("body_html").notNull().default(""),
  enabled: boolean("enabled").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

export type EmailBodyVariant = typeof emailBodyVariants.$inferSelect;

export const LOG_STATUS = ["sent", "failed"] as const;
export type LogStatus = (typeof LOG_STATUS)[number];

export const emailLogs = pgTable("email_logs", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id").references(() => contacts.id),
  campaignId: integer("campaign_id").references(() => emailCampaigns.id),
  subjectVariantId: integer("subject_variant_id"),
  subjectVariantLabel: text("subject_variant_label"),
  bodyVariantId: integer("body_variant_id"),
  bodyVariantLabel: text("body_variant_label"),
  recipient: text("recipient").notNull(),
  subjectSnapshot: text("subject_snapshot").notNull().default(""),
  bodySnapshot: text("body_snapshot").notNull().default(""),
  status: text("status").notNull(),
  smtpMessageId: text("smtp_message_id"),
  error: text("error"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type EmailLog = typeof emailLogs.$inferSelect;

export const REPLY_CLASSIFICATIONS = [
  "unclassified",
  "positive",
  "negative",
  "other",
  "automatic",
] as const;

export const MATCH_METHODS = ["message_id", "sender_fallback"] as const;

export const inboundReplies = pgTable("inbound_replies", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id").references(() => contacts.id),
  emailLogId: integer("email_log_id").references(() => emailLogs.id),
  campaignId: integer("campaign_id").references(() => emailCampaigns.id),
  inboundMessageId: text("inbound_message_id").notNull().unique(),
  fromEmail: text("from_email").notNull(),
  subject: text("subject").notNull().default(""),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  matchMethod: text("match_method").notNull(),
  snippet: text("snippet").notNull().default(""),
  classification: text("classification").notNull().default("unclassified"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type InboundReply = typeof inboundReplies.$inferSelect;

// Single-row (id = 1) cursor for IMAP reply polling.
export const imapState = pgTable("imap_state", {
  id: integer("id").primaryKey(),
  uidvalidity: text("uidvalidity"),
  lastUid: text("last_uid"),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastError: text("last_error"),
});
