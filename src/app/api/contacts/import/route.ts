import { randomBytes } from "node:crypto";
import { inArray } from "drizzle-orm";
import { db, ensureSchema } from "@/db";
import { contacts } from "@/db/schema";
import { isValidEmail, parseCsv } from "@/lib/csv";
import { requireAdmin } from "@/lib/require-admin";

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let content: string;
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return Response.json({ error: "No CSV file uploaded." }, { status: 400 });
    }
    if (file.size > 5 * 1024 * 1024) {
      return Response.json({ error: "File too large (max 5 MB)." }, { status: 400 });
    }
    content = await file.text();
  } catch {
    return Response.json({ error: "Could not read uploaded file." }, { status: 400 });
  }

  const parsed = parseCsv(content);
  if (parsed.fatalError) {
    return Response.json({ error: parsed.fatalError }, { status: 400 });
  }

  try {
    await ensureSchema();
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Database unavailable." },
      { status: 500 }
    );
  }
  const database = db();

  const found = parsed.rows.length;
  let imported = 0;
  let duplicates = 0;
  let invalid = 0;

  // Validate emails first.
  const validRows = [];
  for (const row of parsed.rows) {
    if (!row.email || !isValidEmail(row.email)) {
      invalid += 1;
      continue;
    }
    validRows.push(row);
  }

  // De-duplicate within the file itself (keep first occurrence).
  const seen = new Set<string>();
  const uniqueRows = [];
  for (const row of validRows) {
    if (seen.has(row.email)) {
      duplicates += 1;
      continue;
    }
    seen.add(row.email);
    uniqueRows.push(row);
  }

  // Check against existing DB emails in batches.
  const emails = uniqueRows.map((r) => r.email);
  const existing = new Map<string, string>(); // email -> status
  const BATCH = 500;
  try {
    for (let i = 0; i < emails.length; i += BATCH) {
      const chunk = emails.slice(i, i + BATCH);
       
      const foundRows = await database
        .select({ email: contacts.email, status: contacts.status })
        .from(contacts)
        .where(inArray(contacts.email, chunk));
      for (const r of foundRows) existing.set(r.email, r.status ?? "");
    }
  } catch {
    return Response.json({ error: "Database query failed during import." }, { status: 500 });
  }

  const toInsert = [];
  for (const row of uniqueRows) {
    const status = existing.get(row.email);
    if (status !== undefined) {
      // Never reactivate unsubscribed, never overwrite sent/others: skip all.
      duplicates += 1;
      continue;
    }
    toInsert.push({
      businessName: row.business_name || null,
      trade: row.trade || null,
      email: row.email,
      website: row.website || null,
      phone: row.phone || null,
      googleMapsUrl: row.google_maps_url || null,
      city: row.city || null,
      country: row.country || null,
      status: "pending",
      unsubscribeToken: randomBytes(32).toString("hex"),
    });
  }

  try {
    for (let i = 0; i < toInsert.length; i += BATCH) {
      const chunk = toInsert.slice(i, i + BATCH);
       
      await database.insert(contacts).values(chunk);
      imported += chunk.length;
    }
  } catch {
    return Response.json(
      { error: "Database insert failed. Some rows may have been imported; re-upload to retry (duplicates are skipped)." },
      { status: 500 }
    );
  }

  return Response.json({
    found,
    imported,
    duplicatesSkipped: duplicates,
    invalidSkipped: invalid,
  });
}
