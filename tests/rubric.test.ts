import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { existsSync } from "node:fs";

// rubric.txt is not in git (it names employees with their ratings); these run only where it exists.
const SKIP = !existsSync("rubric.txt") && "rubric.txt not present on this machine";
import { referencedPeople, scoringRubric } from "../lib/rubric";

const content = existsSync("rubric.txt") ? readFileSync("rubric.txt", "utf8") : "";

test("scoring rubric carries no real employee names", { skip: SKIP }, () => {
  const out = scoringRubric(content);
  for (const p of referencedPeople(content)) assert.ok(!new RegExp(`\\b${p}\\b`).test(out), p);
  // All 8 hires + the founder were detected.
  assert.equal(referencedPeople(content).length, 17);
});

test("scoring rubric keeps every category and its anchors", { skip: SKIP }, () => {
  const out = scoringRubric(content);
  for (const c of "ABCDEF") assert.match(out, new RegExp(`CATEGORY ${c} —`));
  assert.match(out, /3 = Sustained, hands-on ownership/);
  assert.match(out, /For SPM specifically/);
  assert.match(out, /counts only alongside evidence in A\/B/i);
  assert.match(out, /A single vocational certificate paired with an unrelated degree .* stays at 0\.25/);
  // Lead-ins to removed name lists keep their reasoning (dropping them silently lost A's and F's core finding).
  assert.match(out, /every "Exceeds Expectations" hire .* BEFORE their current specialty\./);
  assert.match(out, /What the Exceeds hires share is a distinct point of view about their own way of working/);
  assert.match(out, /must express a stance on HOW or WHY the candidate works/);
  assert.match(out, /transition into product\/operations from a genuinely unrelated field/);
  assert.match(out, /Do not let a strong pedigree substitute/);
  assert.doesNotMatch(out, /REMAINING GAP|WHAT CHANGED|OUTPUT FORMAT/);
  // v2.1 anchors survive stripping intact.
  assert.match(out, /OR \(b\) real hands-on ops work, but brief: roughly under 6 months/);
  assert.match(out, /general B\.Com or B\.A\. with no certifications/);
  assert.match(out, /should score LOW here, not high\)$/m);
});

test("fails closed if a name survives somewhere the stripper doesn't clean", { skip: SKIP }, () => {
  const bad = content.replace("CATEGORY E — Qualifications", "CATEGORY E — Rohan's Qualifications");
  assert.throws(() => scoringRubric(bad), /survived/);
});
