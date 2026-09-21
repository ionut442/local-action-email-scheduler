import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { neon } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = neon(url);
  const dir = join(process.cwd(), "drizzle");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (files.length === 0) throw new Error("No .sql migrations found in ./drizzle");
  for (const file of files) {
    console.log(`Applying ${file}...`);
    const content = readFileSync(join(dir, file), "utf8");
    // Strip full-line SQL comments (they may contain semicolons) and
    // drizzle-kit statement-breakpoint markers before splitting.
    const cleaned = content
      .split("\n")
      .filter((l) => {
        const t = l.trim();
        return t && !t.startsWith("--");
      })
      .join("\n");
    const statements = cleaned
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
       
      await sql.query(stmt);
    }
  }
  console.log("Migrations applied.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
