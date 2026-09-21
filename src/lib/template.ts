export const PLACEHOLDERS = [
  "{{business_name}}",
  "{{trade}}",
  "{{email}}",
  "{{website}}",
  "{{city}}",
  "{{country}}",
] as const;

export interface TemplateVars {
  business_name?: string | null;
  trade?: string | null;
  email?: string | null;
  website?: string | null;
  city?: string | null;
  country?: string | null;
}

export function renderTemplate(template: string, vars: TemplateVars): string {
  const safe: Record<string, string> = {
    business_name: (vars.business_name ?? "").trim(),
    trade: (vars.trade ?? "").trim(),
    email: (vars.email ?? "").trim(),
    website: (vars.website ?? "").trim(),
    city: (vars.city ?? "").trim(),
    country: (vars.country ?? "").trim(),
  };
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key: string) => {
    const k = key.toLowerCase();
    return k in safe ? safe[k] : match;
  });
}

/**
 * HTML-safe substitution: placeholder values are HTML-escaped so a business
 * name containing `&` or `<` cannot break the markup. Unknown placeholders
 * are left intact (never silently dropped).
 */
export function renderTemplateHtml(template: string, vars: TemplateVars): string {
  const safe: Record<string, string> = {
    business_name: escapeHtml((vars.business_name ?? "").trim()),
    trade: escapeHtml((vars.trade ?? "").trim()),
    email: escapeHtml((vars.email ?? "").trim()),
    website: escapeHtml((vars.website ?? "").trim()),
    city: escapeHtml((vars.city ?? "").trim()),
    country: escapeHtml((vars.country ?? "").trim()),
  };
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key: string) => {
    const k = key.toLowerCase();
    return k in safe ? safe[k] : match;
  });
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Convert plain-text body to a simple, safe HTML email body. */
export function textToHtml(text: string): string {
  const escaped = escapeHtml(text);
  const withLinks = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1">$1</a>'
  );
  return withLinks
    .split(/\r?\n\r?\n+/)
    .map((para) => `<p>${para.replace(/\r?\n/g, "<br>")}</p>`)
    .join("\n");
}

export function getAppUrl(): string {
  const url = (process.env.APP_URL ?? "").trim().replace(/\/+$/, "");
  if (url) return url;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export function unsubscribeUrlFor(token: string): string {
  return `${getAppUrl()}/unsubscribe?token=${encodeURIComponent(token)}`;
}

/** Strip all HTML tags (used for subjects and plain-text fallbacks). */
export function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Convert an HTML body to a reasonable plain-text version. */
export function htmlToText(html: string): string {
  return decodeEntities(
    stripTags(
      html
        .replace(/<(br|p|div|li|h[1-6]|tr)[^>]*>/gi, "\n")
        .replace(/<\/(p|div|h[1-6]|ul|ol|table|tr)>/gi, "\n")
    )
  )
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}
