import { asc, eq } from "drizzle-orm";
import { db, ensureSchema } from "@/db";
import {
  emailBodyVariants,
  emailCampaigns,
  emailLogs,
  emailSettings,
  emailSubjectVariants,
} from "@/db/schema";
import { DEFAULT_SIGNATURE_HTML, DEFAULT_SIGNATURE_TEXT, getVariantDistribution } from "@/lib/experiment";
import { requireAdmin } from "@/lib/require-admin";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    await ensureSchema();
    const database = db();
    const campaigns = await database
      .select()
      .from(emailCampaigns)
      .orderBy(asc(emailCampaigns.id));
    const active = campaigns.find((c) => c.active) ?? null;
    let subjects: typeof emailSubjectVariants.$inferSelect[] = [];
    let bodies: typeof emailBodyVariants.$inferSelect[] = [];
    let distribution = null;
    if (active) {
      subjects = await database
        .select()
        .from(emailSubjectVariants)
        .where(eq(emailSubjectVariants.campaignId, active.id))
        .orderBy(asc(emailSubjectVariants.sortOrder), asc(emailSubjectVariants.id));
      bodies = await database
        .select()
        .from(emailBodyVariants)
        .where(eq(emailBodyVariants.campaignId, active.id))
        .orderBy(asc(emailBodyVariants.sortOrder), asc(emailBodyVariants.id));
      distribution = await getVariantDistribution(active.id);
    }
    const settingsRows = await database
      .select({
        signatureHtml: emailSettings.signatureHtml,
        signatureText: emailSettings.signatureText,
      })
      .from(emailSettings)
      .where(eq(emailSettings.id, 1))
      .limit(1);
    return Response.json({
      campaigns,
      active,
      subjects,
      bodies,
      distribution,
      signature: {
        html: settingsRows[0]?.signatureHtml || DEFAULT_SIGNATURE_HTML,
        text: settingsRows[0]?.signatureText || DEFAULT_SIGNATURE_TEXT,
      },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Database unavailable." },
      { status: 500 }
    );
  }
}

interface VariantInput {
  id?: number;
  label?: string;
  subject?: string;
  bodyHtml?: string;
  enabled?: boolean;
  sortOrder?: number;
}

function cleanLabel(v: unknown): string {
  return String(v ?? "").trim().slice(0, 50);
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let data: {
    campaignId?: number;
    name?: string;
    mode?: string;
    active?: boolean;
    subjects?: VariantInput[];
    bodies?: VariantInput[];
    deleteSubjectIds?: number[];
    deleteBodyIds?: number[];
    signatureHtml?: string;
    signatureText?: string;
  };
  try {
    data = (await req.json()) as typeof data;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    await ensureSchema();
    const database = db();

    // No campaign yet: create the first one.
    let campaignId = data.campaignId;
    if (!campaignId) {
      const inserted = await database
        .insert(emailCampaigns)
        .values({
          name: String(data.name ?? "Product Research Campaign").slice(0, 200) || "Product Research Campaign",
          mode: data.mode === "experiment" ? "experiment" : "single",
          active: data.active === true,
        })
        .returning({ id: emailCampaigns.id });
      campaignId = inserted[0].id;
    } else {
      const existing = await database
        .select()
        .from(emailCampaigns)
        .where(eq(emailCampaigns.id, campaignId))
        .limit(1);
      if (!existing[0]) return Response.json({ error: "Campaign not found." }, { status: 404 });
      const patch: Partial<typeof emailCampaigns.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (typeof data.name === "string" && data.name.trim()) {
        patch.name = data.name.trim().slice(0, 200);
      }
      if (data.mode === "single" || data.mode === "experiment") patch.mode = data.mode;
      if (typeof data.active === "boolean") patch.active = data.active;
      await database
        .update(emailCampaigns)
        .set(patch)
        .where(eq(emailCampaigns.id, campaignId));
    }

    // Only one active campaign at a time.
    if (data.active === true) {
      const all = await database.select({ id: emailCampaigns.id }).from(emailCampaigns);
      for (const c of all) {
        if (c.id !== campaignId) {
           
          await database
            .update(emailCampaigns)
            .set({ active: false, updatedAt: new Date() })
            .where(eq(emailCampaigns.id, c.id));
        }
      }
    }

    // Upsert subject variants.
    if (Array.isArray(data.subjects)) {
      if (data.subjects.length > 20) {
        return Response.json({ error: "Too many subject variants (max 20)." }, { status: 400 });
      }
      let order = 0;
      for (const v of data.subjects) {
        const subject = String(v.subject ?? "");
        if (subject.length > 500) {
          return Response.json({ error: "Subject too long (max 500 chars)." }, { status: 400 });
        }
        const row = {
          campaignId,
          label: cleanLabel(v.label) || `S${order + 1}`,
          subject,
          enabled: v.enabled !== false,
          sortOrder: Number.isInteger(v.sortOrder) ? (v.sortOrder as number) : order,
        };
        if (v.id) {
           
          await database
            .update(emailSubjectVariants)
            .set(row)
            .where(eq(emailSubjectVariants.id, v.id));
        } else {
           
          await database.insert(emailSubjectVariants).values(row);
        }
        order += 1;
      }
    }

    // Upsert body variants.
    if (Array.isArray(data.bodies)) {
      if (data.bodies.length > 20) {
        return Response.json({ error: "Too many body variants (max 20)." }, { status: 400 });
      }
      let order = 0;
      for (const v of data.bodies) {
        const bodyHtml = String(v.bodyHtml ?? "");
        if (bodyHtml.length > 100000) {
          return Response.json({ error: "Body too long (max 100k chars)." }, { status: 400 });
        }
        const row = {
          campaignId,
          label: cleanLabel(v.label) || `B${order + 1}`,
          bodyHtml,
          enabled: v.enabled !== false,
          sortOrder: Number.isInteger(v.sortOrder) ? (v.sortOrder as number) : order,
        };
        if (v.id) {
           
          await database
            .update(emailBodyVariants)
            .set(row)
            .where(eq(emailBodyVariants.id, v.id));
        } else {
           
          await database.insert(emailBodyVariants).values(row);
        }
        order += 1;
      }
    }

    // Delete variants only when they have no sent emails behind them.
    if (Array.isArray(data.deleteSubjectIds) && data.deleteSubjectIds.length > 0) {
      for (const id of data.deleteSubjectIds.filter((n) => Number.isInteger(n))) {
         
        const used = await database
          .select({ id: emailLogs.id })
          .from(emailLogs)
          .where(eq(emailLogs.subjectVariantId, id))
          .limit(1);
        if (used.length > 0) {
          return Response.json(
            { error: `Subject variant ${id} already has sent emails and cannot be deleted (disable it instead).` },
            { status: 400 }
          );
        }
         
        await database
          .delete(emailSubjectVariants)
          .where(eq(emailSubjectVariants.id, id));
      }
    }
    if (Array.isArray(data.deleteBodyIds) && data.deleteBodyIds.length > 0) {
      for (const id of data.deleteBodyIds.filter((n) => Number.isInteger(n))) {
         
        const used = await database
          .select({ id: emailLogs.id })
          .from(emailLogs)
          .where(eq(emailLogs.bodyVariantId, id))
          .limit(1);
        if (used.length > 0) {
          return Response.json(
            { error: `Body variant ${id} already has sent emails and cannot be deleted (disable it instead).` },
            { status: 400 }
          );
        }
         
        await database.delete(emailBodyVariants).where(eq(emailBodyVariants.id, id));
      }
    }

    // Global signature (stored on the singleton settings row).
    if (typeof data.signatureHtml === "string" || typeof data.signatureText === "string") {
      const patch: Partial<typeof emailSettings.$inferInsert> = { updatedAt: new Date() };
      if (typeof data.signatureHtml === "string") {
        patch.signatureHtml = data.signatureHtml.slice(0, 5000);
      }
      if (typeof data.signatureText === "string") {
        patch.signatureText = data.signatureText.slice(0, 2000);
      }
       
      await database
        .insert(emailSettings)
        .values({ id: 1, ...patch } as typeof emailSettings.$inferInsert)
        .onConflictDoUpdate({ target: emailSettings.id, set: patch });
    }

    return Response.json({ ok: true, campaignId });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Database unavailable." },
      { status: 500 }
    );
  }
}
