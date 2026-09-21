import { parse } from "csv-parse/sync";

export const EXPECTED_COLUMNS = [
  "business_name",
  "trade",
  "email",
  "website",
  "phone",
  "google_maps_url",
  "city",
  "country",
] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface ParsedRow {
  business_name: string;
  trade: string;
  email: string;
  website: string;
  phone: string;
  google_maps_url: string;
  city: string;
  country: string;
  line: number;
}

export interface CsvParseResult {
  rows: ParsedRow[];
  fatalError?: string;
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  if (email.length > 320) return false;
  return EMAIL_RE.test(email);
}

function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z_]/g, "");
}

/** Excel in many locales (incl. Romanian) exports `;`-separated CSVs. Detect it. */
function detectDelimiter(firstLine: string): "," | ";" {
  const semis = (firstLine.match(/;/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return semis > commas ? ";" : ",";
}

export function parseCsv(content: string): CsvParseResult {
  const firstLine = content.split(/\r?\n/, 1)[0] ?? "";
  let records: Record<string, string>[];
  try {
    records = parse(content, {
      columns: (header: string[]) => header.map(normalizeHeader),
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      bom: true,
      delimiter: detectDelimiter(firstLine),
    }) as Record<string, string>[];
  } catch (err) {
    return {
      rows: [],
      fatalError:
        err instanceof Error ? err.message : "Could not parse CSV file.",
    };
  }
  if (records.length === 0) {
    return { rows: [], fatalError: "CSV file contains no data rows." };
  }
  if (!("email" in (records[0] ?? {}))) {
    return {
      rows: [],
      fatalError:
        "CSV is missing the required 'email' column. Download the CSV template to see the expected format.",
    };
  }
  const rows: ParsedRow[] = records.map((r, i) => ({
    business_name: (r.business_name ?? "").trim().slice(0, 500),
    trade: (r.trade ?? "").trim().slice(0, 200),
    email: normalizeEmail(r.email ?? ""),
    website: (r.website ?? "").trim().slice(0, 1000),
    phone: (r.phone ?? "").trim().slice(0, 100),
    google_maps_url: (r.google_maps_url ?? "").trim().slice(0, 2000),
    city: (r.city ?? "").trim().slice(0, 200),
    country: (r.country ?? "").trim().slice(0, 200),
    line: i + 2, // 1-based incl. header
  }));
  return { rows };
}

export function csvTemplate(): string {
  return "business_name,trade,email,website,phone,google_maps_url,city,country\nExample Business,plumber,hello@example.com,https://example.com,+1 555 0100,https://maps.google.com/?q=Example,Berlin,Germany\n";
}
