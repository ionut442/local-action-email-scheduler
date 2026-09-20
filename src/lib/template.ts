export const PLACEHOLDERS = [
  "{{business_name}}",
  "{{email}}",
  "{{website}}",
  "{{city}}",
  "{{country}}",
] as const;

export interface TemplateVars {
  business_name?: string | null;
  email?: string | null;
  website?: string | null;
  city?: string | null;
  country?: string | null;
}

export function renderTemplate(template: string, vars: TemplateVars): string {
  const safe: Record<string, string> = {
    business_name: (vars.business_name ?? "").trim(),
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

export function buildUnsubscribeFooterHtml(unsubscribeUrl: string): string {
  return `<p style="font-size:12px;color:#888;margin-top:24px;">You can opt out of future emails here: <a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe</a></p>`;
}

export function buildUnsubscribeFooterText(unsubscribeUrl: string): string {
  return `\n\n--\nYou can opt out of future emails here: ${unsubscribeUrl}`;
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
