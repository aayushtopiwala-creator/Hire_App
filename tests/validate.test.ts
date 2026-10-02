import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareEmail } from "../lib/email/validate";
import { splitPii } from "../lib/pii";

const personal = splitPii("Neha Kulkarni\nneha@example.com\n").personal;

test("fills [FIRST_NAME] locally", () => {
  assert.deepEqual(prepareEmail("Hello", "Hi [FIRST_NAME],\nthanks", personal), { subject: "Hello", text: "Hi Neha,\nthanks" });
});

test("rejects redaction placeholders before filling (the bug that let 'Hi [CANDIDATE]' through)", () => {
  for (const body of ["Hi [CANDIDATE]", "per [REFERENCE]", "reach me at [CONTACT]", "see [LINK]"]) {
    assert.ok("error" in prepareEmail("x", body, personal), body);
  }
});

test("rejects unknown bracket placeholders and empty fields", () => {
  assert.ok("error" in prepareEmail("x", "Hi [SOMETHING]", personal));
  assert.ok("error" in prepareEmail("x", "   ", personal));
  assert.ok("error" in prepareEmail(undefined, "body", personal));
});

import { checkDraft } from "../lib/ai/draft";

test("draft checks: pronouns in brief, screening words, misquotes", () => {
  const base = { brief: "The candidate ran ops. They ranked first on ops evidence. Probe their craft.", email_subject: "Your ops work", email_body: "Hi [FIRST_NAME],\nYour carrier planning work stood out.\nBest,\nArjun", referenced_details: ["carrier planning"] };
  const profile = JSON.stringify({ x: "carrier planning for 4 accounts" });
  const cv = "Managed carrier planning for 4 accounts.";
  assert.deepEqual(checkDraft("invite", base, profile, cv), []);
  assert.ok(checkDraft("invite", { ...base, brief: "She ran ops. She ranked first. Probe her craft." }, profile, cv).some((p) => p.includes("gendered")));
  assert.ok(checkDraft("invite", { ...base, email_body: base.email_body + "\nYou scored 9/10 on our rubric." }, profile, cv).some((p) => p.includes("scoring")));
  assert.ok(checkDraft("invite", { ...base, email_body: base.email_body + '\nAs you put it, "I owned every carrier contract".' }, profile, cv).some((p) => p.includes("verbatim")));
});

import { REJECTION_REASON } from "../lib/ai/draft";

test("rejection-reason check catches experience-based reasons but not a plain decision", () => {
  for (const bad of ["We are looking for someone with more prior experience.", "this position is scoped differently from the depth of leadership you bring", "we are focusing on candidates with deep, direct experience"]) assert.match(bad, REJECTION_REASON);
  assert.doesNotMatch("We've decided not to move forward with your application for the Product Manager role.", REJECTION_REASON);
});
