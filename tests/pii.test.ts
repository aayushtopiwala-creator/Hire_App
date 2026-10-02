import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { extractText } from "../lib/parse";
import { findPii, splitPii } from "../lib/pii";

const cases = [
  { file: "fixtures/strong_pm_neha_kulkarni.pdf", name: "Neha Kulkarni", email: "neha.kulkarni.test@example.com", phoneDigits: "919820011223" },
  { file: "fixtures/weak_spm_karan_malhotra.docx", name: "Karan Malhotra", email: "karan.malhotra.test@example.com", phoneDigits: "9987044556" },
  { file: "fixtures/ambiguous_pm_farah_sayed.txt", name: "Farah Sayed", email: "farah.sayed.test@example.com", phoneDigits: "02223456789" },
];

for (const c of cases) {
  test(`parse + PII split: ${c.file}`, async () => {
    const raw = await extractText(readFileSync(c.file), c.file);
    const { personal, redacted } = splitPii(raw);

    assert.equal(personal.name, c.name);
    assert.equal(personal.email, c.email);
    assert.equal(personal.phone?.replace(/\D/g, ""), c.phoneDigits);

    // Nothing identifying survives in the redacted text.
    for (const tok of c.name.split(" ")) assert.ok(!new RegExp(`\\b${tok}\\b`, "i").test(redacted), `${tok} leaked`);
    assert.ok(!redacted.includes("@"), "email leaked");
    assert.ok(!redacted.includes(c.phoneDigits.slice(-4)), "phone leaked");
    assert.ok(redacted.includes("[CANDIDATE]") || !raw.includes(c.name));
    assert.ok(findPii(redacted, personal).ok, JSON.stringify(findPii(redacted, personal).leaks));

    // Substance survives.
    assert.ok(redacted.length > raw.length * 0.8);
  });
}

test("third-party attribution is redacted but the title is kept", async () => {
  const raw = await extractText(readFileSync(cases[0].file), cases[0].file);
  const { personal, redacted } = splitPii(raw);
  assert.ok(!redacted.includes("Rahul Menon"));
  assert.match(redacted, /\[REFERENCE\], Engineering Lead/);
  assert.deepEqual(personal.third_party_names, ["Rahul Menon"]);
  // The quote itself (with the candidate's name redacted) is kept for rubric Category F.
  assert.match(redacted, /\[CANDIDATE\] is the only PM/);
});

test("linkedin and portfolio links are removed", async () => {
  const raw = await extractText(readFileSync(cases[2].file), cases[2].file);
  const { personal, redacted } = splitPii(raw);
  assert.ok(!redacted.includes("farahsayed"));
  assert.equal(personal.links.length, 1);
});

test("year ranges and metrics are not mistaken for phones", () => {
  const { redacted, personal } = splitPii("Asha Rao\nJan 2019 – Dec 2022\nCut costs 31% across 1200000 shipments");
  assert.equal(personal.phone, null);
  assert.match(redacted, /2019 – Dec 2022/);
});

test("guard flags leaks in candidate content but not a shared first name in the static rubric", () => {
  const personal = splitPii("Rahul Kapoor\nrahul@example.com\n").personal;
  assert.equal(findPii("profile text", personal, "Rahul Desh (Growth, Meets)").ok, true);
  assert.equal(findPii("Rahul did this", personal).ok, false);
  assert.equal(findPii("reach me at a.b@example.com", null).ok, false);
  assert.equal(findPii("call +91 98200 11223", null).ok, false);
});

test("third-party names in running text are redacted; organisations are not", () => {
  const cv = [
    "Asha Rao",
    "asha@example.com",
    "Worked closely with Priya Nair on the carrier onboarding flow.",
    "Reporting to Vikram Sethi (VP Product), I owned the customs module; Vikram later made it a team standard.",
    "Mentored by Dr. Sharma during the rotation.",
    "Arjun Kapoor, our CTO, signed off the migration.",
    "Partnered with Maersk Line and worked with Allcargo Logistics on EDI feeds.",
    "Collaborated with JNPT Terminal staff and the Sales Team.",
    "Coordinated with shipping lines at Nhava Sheva.",
  ].join("\n");
  const { personal, redacted } = splitPii(cv);
  for (const n of ["Priya", "Nair", "Vikram", "Sethi", "Sharma", "Arjun", "Kapoor"]) assert.ok(!new RegExp(`\\b${n}\\b`).test(redacted), `${n} leaked:\n${redacted}`);
  assert.match(redacted, /Worked closely with \[REFERENCE\] on/);
  assert.match(redacted, /Reporting to \[REFERENCE\] \(VP Product\)/);
  assert.match(redacted, /\[REFERENCE\] later made it/); // first-name-only later mention
  assert.match(redacted, /Mentored by Dr\. \[REFERENCE\]/);
  assert.match(redacted, /\[REFERENCE\], our CTO/);
  for (const org of ["Maersk Line", "Allcargo Logistics", "JNPT Terminal", "Sales Team", "Nhava Sheva"]) assert.ok(redacted.includes(org), `${org} wrongly redacted`);
  assert.deepEqual(new Set(personal.third_party_names), new Set(["Dr. Sharma", "Priya Nair", "Vikram Sethi", "Arjun Kapoor"]));
  assert.ok(findPii(redacted, personal).ok);
  assert.equal(findPii("notes: Priya Nair said so", personal).ok, false); // the guard now knows third parties
});

// Layouts seen in the real applications/ CVs, with invented names.
test("designed-PDF header extracted last: glued upper/title duplicate before the email", () => {
  const raw = "Strategy & Operations Leader | Corporate Strategy\nEDUCATION\nPGDM\nIMT Ghaziabad | 2022 – 2024\n...\nASHA RAOAsha Rao\nasha@example.com+91 98202 1134598202 11345 asha-rao\n";
  const { personal, redacted } = splitPii(raw, { fileName: "07_asha_rao.pdf" });
  assert.equal(personal.name, "Asha Rao");
  assert.equal(personal.name_method, "contact_line");
  assert.ok(personal.phone);
  assert.doesNotMatch(redacted, /asha|rao|98202/i);
  assert.match(redacted, /IMT Ghaziabad/); // a header institution is not mistaken for the name
});

test("name glued onto the end of a sentence, title/upper order", () => {
  const raw = "Led product design and fundraising.NIKHIL RANAnikhil Rana\nnr@example.com+91 98142 7031898142 70318\n";
  const { personal } = splitPii(raw.replace("RANAnikhil", "RANANikhil"));
  assert.equal(personal.name, "Nikhil Rana");
});

test("name on the same line as the email", () => {
  const { personal, redacted } = splitPii("Mira Joshi kj@example.com\n+91 97200 54318 · Pune\nlinkedin.com/in/mirajoshi-ops\nProfessional Summary\n...");
  assert.equal(personal.name, "Mira Joshi");
  assert.doesNotMatch(redacted, /mira|joshi/i);
});

test("same number printed three times, glued to a following word", () => {
  const { personal, redacted } = splitPii("Dev Anand\nd@example.com +91 99014 2845399014 28453 99014 28453dev-anand-pm\n");
  assert.ok(personal.phone);
  assert.doesNotMatch(redacted, /99014|28453/);
});

test("header-only name is low confidence; nothing found is null", () => {
  assert.equal(splitPii("Tara Bose\nProduct things without contact details\n").personal.name_confidence, "low");
  assert.equal(splitPii("Product things\nmore things\n").personal.name, null);
});

test("file-name tripwire blocks a name the detector missed", () => {
  const personal = splitPii("Product things\n", { fileName: "12_tara_bose.pdf" }).personal;
  assert.deepEqual(personal.tripwire_tokens, ["tara", "bose"]);
  assert.equal(findPii("…worked as Tara Bose at…", personal).ok, false);
  assert.equal(findPii("…the tara-bose slug…", personal).ok, false);
  assert.equal(findPii("…a bose speaker, tara the rep…", personal).ok, true); // single words alone don't trip it
});

test("founder-entered name overrides detection and redacts", () => {
  const { personal, redacted } = splitPii("Product things\nI am Tara Bose\n", { name: "Tara Bose" });
  assert.equal(personal.name_confidence, "founder");
  assert.doesNotMatch(redacted, /tara|bose/i);
});

test("real-CV false positives are no longer redacted as third-party names", () => {
  const cv = [
    "Asha Rao",
    "asha@example.com",
    "Co-Founder & Operations Lead | FreshCo",
    "— Reports to Head of Product; owns 1 feature area",
    "Oct 2022 – Present",
    "Associate Product Manager - BetterCo",
    "Jan 2026 - PresentProduct Head - Impact Co",
    "AI-Driven Product Leader & Former Founder with 8+ years",
    "Moonco – Failed Founder (No code Platform)",
    "Dr Reddy’s Laboratories | Young Leaders’ Program",
    "WORK EXPERIENCE ~ 13 Years",
    "Ola, Bangalore AI Program Manager",
    "Worked with Chief Business Officer on project costs",
    "Worked with Piramal Realty on contracts",
  ].join("\n");
  const { personal, redacted } = splitPii(cv);
  assert.deepEqual(personal.third_party_names, [], JSON.stringify(personal.third_party_names));
  assert.doesNotMatch(redacted, /\[REFERENCE\]/);
});

test("real attributions still work after tightening", () => {
  const { personal, redacted } = splitPii("Asha Rao\nasha@example.com\n\"Best PM I've had.\"\n— Rahul Menon, Engineering Lead, Dockline\n");
  assert.deepEqual(personal.third_party_names, ["Rahul Menon"]);
  assert.match(redacted, /— \[REFERENCE\], Engineering Lead/);
});
