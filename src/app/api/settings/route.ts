import { eq } from "drizzle-orm";
import { db, ensureSchema } from "@/db";
import { emailSettings } from "@/db/schema";
import { requireAdmin } from "@/lib/require-admin";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    await ensureSchema();
    const rows = await db()
      .select()
      .from(emailSettings)
      .where(eq(emailSettings.id, 1))
      .limit(1);
    return Response.json(
      rows[0] ?? {
        subject: "",
        body: "",
        senderName: "Denis Oproiu",
        dailyLimit: 30,
        sendingEnabled: false,
        bodyIsHtml: false,
        signatureHtml: "",
        signatureText: "",
      }
    );
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Database unavailable." },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let data: {
    subject?: string;
    body?: string;
    senderName?: string;
    dailyLimit?: number;
    sendingEnabled?: boolean;
    bodyIsHtml?: boolean;
    signatureHtml?: string;
    signatureText?: string;
  };
  try {
    data = (await req.json()) as typeof data;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const subject = String(data.subject ?? "");
  const body = String(data.body ?? "");
  const senderName = String(data.senderName ?? "Denis Oproiu").slice(0, 200) || "Denis Oproiu";
  const dailyLimit = Number(data.dailyLimit);
  const sendingEnabled = data.sendingEnabled === true;
  const bodyIsHtml = data.bodyIsHtml === true;
  const signatureHtml = String(data.signatureHtml ?? "").slice(0, 5000);
  const signatureText = String(data.signatureText ?? "").slice(0, 2000);

  if (subject.length > 500) {
    return Response.json({ error: "Subject too long (max 500 chars)." }, { status: 400 });
  }
  if (body.length > 100000) {
    return Response.json({ error: "Body too long (max 100k chars)." }, { status: 400 });
  }
  if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 500) {
    return Response.json(
      { error: "Daily limit must be an integer between 1 and 500." },
      { status: 400 }
    );
  }

  try {
    await ensureSchema();
    await db()
      .insert(emailSettings)
      .values({
        id: 1,
        subject,
        body,
        senderName,
        dailyLimit,
        sendingEnabled,
        bodyIsHtml,
        signatureHtml,
        signatureText,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: emailSettings.id,
        set: { subject, body, senderName, dailyLimit, sendingEnabled, bodyIsHtml, signatureHtml, signatureText, updatedAt: new Date() },
      });
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Database unavailable." },
      { status: 500 }
    );
  }
}
