// Experiment system tests (pure functions, no DB).
// Run: npx tsx scripts/test-experiment.ts
import { pickLeastUsedCombo } from "../src/lib/experiment";
import {
  renderTemplate,
  renderTemplateHtml,
  htmlToText,
  indefiniteArticle,
  aTrade,
} from "../src/lib/template";
import {
  normalizeMessageId,
  extractEmailAddress,
  isAutomaticReply,
  snippetFromText,
} from "../src/lib/replies";
import { parseCsv } from "../src/lib/csv";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`ok   ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// Deterministic PRNG for reproducible distribution tests.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function testDistribution(total: number, activeSubs: number, activeBodies: number) {
  const combos: { key: string }[] = [];
  for (let s = 0; s < activeSubs; s += 1)
    for (let b = 0; b < activeBodies; b += 1) combos.push({ key: `${s}:${b}` });
  const counts = new Map<string, number>();
  const rand = mulberry32(42);
  for (let i = 0; i < total; i += 1) {
    const picked = pickLeastUsedCombo(combos, counts, rand);
    if (!picked) return { ok: false, detail: "no pick" };
    counts.set(picked.key, (counts.get(picked.key) ?? 0) + 1);
  }
  const expected = total / combos.length;
  for (const c of combos) {
    if ((counts.get(c.key) ?? 0) !== expected) {
      return { ok: false, detail: `${c.key}=${counts.get(c.key) ?? 0}, want ${expected}` };
    }
  }
  return { ok: true, detail: "" };
}

const d25 = testDistribution(25, 5, 5);
check("distribution 25 sends → each combo ×1", d25.ok, d25.detail);
const d100 = testDistribution(100, 5, 5);
check("distribution 100 sends → each combo ×4", d100.ok, d100.detail);
const d200 = testDistribution(200, 5, 5);
check("distribution 200 sends → each combo ×8", d200.ok, d200.detail);
const dPartial = testDistribution(60, 3, 4);
check("distribution 60 sends over 12 combos → each ×5", dPartial.ok, dPartial.detail);
check("empty combo list → null", pickLeastUsedCombo([], new Map()) === null);

// --- HTML rendering ---
const evil = {
  business_name: "Acme & Sons <Ltd>",
  trade: "plumber",
  email: "a@b.co",
  website: "https://a.co",
  city: "Berlin",
  country: "Germany",
};
const html = renderTemplateHtml("<p>Hi {{business_name}}, {{trade}}! {{unknown}}</p>", evil);
check(
  "HTML values escaped, unknown kept",
  html === "<p>Hi Acme &amp; Sons &lt;Ltd&gt;, plumber! {{unknown}}</p>",
  html
);
check(
  "subject stays plain text (angle brackets survive)",
  renderTemplate("A question about {{business_name}}", evil) ===
    "A question about Acme & Sons <Ltd>"
);
const sig = `<p>\nDenis Oproiu<br>\nProduct Designer<br>\n<a href="https://local-action.com">local-action.com</a>\n</p>`;
const full = renderTemplateHtml(`<p>Hi {{business_name}},</p>\n${sig}`, evil);
check("signature appended to HTML", full.includes('<a href="https://local-action.com">local-action.com</a>'));
const text = htmlToText(full);
check(
  "plain-text fallback with signature",
  text.includes("Hi Acme & Sons <Ltd>,") &&
    text.includes("Denis Oproiu\nProduct Designer\nlocal-action.com"),
  JSON.stringify(text)
);
check(
  "bold/italic/link/lists survive",
  renderTemplateHtml("<p><strong>B</strong> <em>I</em> <a href=\"https://x.co\">L</a></p><ul><li>one</li></ul>", evil).includes("<strong>B</strong>")
);

// --- Smart article {{a_trade}} ---
check("an electrician", aTrade("electrician") === "an electrician");
check("a plumber", aTrade("plumber") === "a plumber");
check("an architect", aTrade("architect") === "an architect");
check("a roofer", aTrade("  roofer ") === "a roofer");
check("an HVAC technician (acronym)", aTrade("HVAC technician") === "an HVAC technician");
check("a GC (acronym, consonant sound)", aTrade("GC") === "a GC");
check("empty trade renders empty", aTrade("") === "" && aTrade(null) === "");
check("indefiniteArticle empty defaults to a", indefiniteArticle("") === "a");
check(
  "S2 with {{a_trade}}",
  renderTemplate("Could I get your perspective as {{a_trade}}?", {
    ...evil,
    trade: "electrician",
  }) === "Could I get your perspective as an electrician?"
);
check(
  "{{a_trade}} escaped in HTML",
  renderTemplateHtml("<p>{{a_trade}}</p>", { ...evil, trade: "plumber" }) ===
    "<p>a plumber</p>"
);

// --- Reply matching helpers ---
check("normalize <ID@x> ", normalizeMessageId("  <AbC@X.io> ") === "abc@x.io");
check("normalize bare", normalizeMessageId("abc@x.io") === "abc@x.io");
check("extract bracket", extractEmailAddress("John Doe <john@doe.com>") === "john@doe.com");
check("extract bare", extractEmailAddress("JOHN@DOE.COM") === "john@doe.com");
check("extract empty", extractEmailAddress("") === "");

const auto1 = isAutomaticReply({
  headers: { "auto-submitted": ["auto-replied"] },
  subject: "Re: hello",
  snippet: "thanks",
  fromEmail: "a@b.co",
});
check("auto-submitted header → automatic", auto1);
const auto2 = isAutomaticReply({
  headers: { precedence: ["bulk"] },
  subject: "Re: hello",
  snippet: "thanks",
  fromEmail: "a@b.co",
});
check("precedence bulk → automatic", auto2);
const auto3 = isAutomaticReply({
  headers: {},
  subject: "Out of Office: away",
  snippet: "I am away",
  fromEmail: "a@b.co",
});
check("OOO subject → automatic", auto3);
const auto4 = isAutomaticReply({
  headers: {},
  subject: "Undelivered Mail Returned",
  snippet: "failed",
  fromEmail: "mailer-daemon@x.io",
});
check("mailer-daemon → automatic", auto4);
const genuine = isAutomaticReply({
  headers: {},
  subject: "Re: A question about Acme",
  snippet: "Hi Denis, happy to help next Tuesday.",
  fromEmail: "info@acme.co",
});
check("genuine reply → not automatic", !genuine);
check(
  "snippet strips html",
  snippetFromText("<p>Hello <b>there</b></p><p>line2</p>").includes("Hello there")
);

// --- CSV with trade ---
const withTrade = parseCsv("business_name,trade,email\nAcme,plumber,ACME@x.co\n");
check(
  "csv trade parsed + email normalized",
  !withTrade.fatalError && withTrade.rows[0].trade === "plumber" && withTrade.rows[0].email === "acme@x.co"
);
const noTrade = parseCsv("business_name,email\nAcme,acme@x.co\n");
check(
  "csv without trade still works",
  !noTrade.fatalError && noTrade.rows[0].trade === ""
);

if (failures > 0) {
  console.log(`\n${failures} FAILURE(S)`);
  process.exit(1);
}
console.log("\nAll experiment tests passed.");
