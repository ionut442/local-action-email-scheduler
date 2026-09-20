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
  senderName: text("sender_name").notNull().default("LocalAction"),
  dailyLimit: integer("daily_limit").notNull().default(30),
  sendingEnabled: boolean("sending_enabled").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type EmailSettings = typeof emailSettings.$inferSelect;

export const LOG_STATUS = ["sent", "failed"] as const;
export type LogStatus = (typeof LOG_STATUS)[number];

export const emailLogs = pgTable("email_logs", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id").references(() => contacts.id),
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
