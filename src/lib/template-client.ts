export const PLACEHOLDERS = [
  "{{business_name}}",
  "{{trade}}",
  "{{email}}",
  "{{website}}",
  "{{city}}",
  "{{country}}",
] as const;

export const SAMPLE_VARS: Record<string, string> = {
  business_name: "Example Business",
  trade: "plumber",
  email: "hello@example.com",
  website: "https://example.com",
  city: "Berlin",
  country: "Germany",
};
