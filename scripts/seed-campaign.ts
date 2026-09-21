import { eq } from "drizzle-orm";
import { db, ensureSchema } from "@/db";
import {
  emailBodyVariants,
  emailCampaigns,
  emailSettings,
  emailSubjectVariants,
} from "@/db/schema";
import {
  DEFAULT_SIGNATURE_HTML,
  DEFAULT_SIGNATURE_TEXT,
} from "@/lib/experiment";

const SUBJECTS = [
  "A question about {{business_name}}",
  "Could I get your perspective as a {{trade}}?",
  "What is missing from the tools you use for your business?",
  "LocalAction product research: could I get your input?",
  "What still feels too manual in your business?",
];

const BODY_PLACEHOLDER = (label: string) =>
  `<p>Hi {{business_name}},</p>\n<p>[Replace this text with body variant ${label} in the Email page. Supports HTML, placeholders and lists.]</p>`;

async function main() {
  await ensureSchema();
  const database = db();

  const existing = await database.select({ id: emailCampaigns.id }).from(emailCampaigns);
  if (existing.length === 0) {
    const inserted = await database
      .insert(emailCampaigns)
      .values({ name: "Product Research Campaign", mode: "experiment", active: false })
      .returning({ id: emailCampaigns.id });
    const campaignId = inserted[0].id;
    for (let i = 0; i < SUBJECTS.length; i += 1) {
       
      await database.insert(emailSubjectVariants).values({
        campaignId,
        label: `S${i + 1}`,
        subject: SUBJECTS[i],
        enabled: true,
        sortOrder: i,
      });
    }
    for (let i = 0; i < 5; i += 1) {
      const label = `B${i + 1}`;
       
      await database.insert(emailBodyVariants).values({
        campaignId,
        label,
        bodyHtml: BODY_PLACEHOLDER(label),
        // Bodies ship disabled: enable each one in the UI once real copy is in.
        enabled: false,
        sortOrder: i,
      });
    }
    console.log(`Seeded campaign ${campaignId} (inactive, 5 subjects on, 5 bodies off).`);
  } else {
    console.log("Campaigns already exist — skipping variant seed.");
  }

  // Global signature + sender name (only fill when empty, never overwrite edits).
  const settings = await database
    .select()
    .from(emailSettings)
    .where(eq(emailSettings.id, 1))
    .limit(1);
  const current = settings[0];
  const patch: Partial<typeof emailSettings.$inferInsert> = { updatedAt: new Date() };
  if (!current?.signatureHtml) patch.signatureHtml = DEFAULT_SIGNATURE_HTML;
  if (!current?.signatureText) patch.signatureText = DEFAULT_SIGNATURE_TEXT;
  patch.senderName = "Denis Oproiu";
  await database
    .insert(emailSettings)
    .values({ id: 1, ...patch } as typeof emailSettings.$inferInsert)
    .onConflictDoUpdate({ target: emailSettings.id, set: patch });
  console.log("Signature defaults ensured; sender name set to Denis Oproiu.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
