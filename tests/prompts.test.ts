import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { existsSync } from "node:fs";

// rubric.txt is not in git (it names employees with their ratings); these run only where it exists.
const SKIP = !existsSync("rubric.txt") && "rubric.txt not present on this machine";
import { INVITE, REJECT, personalize } from "../lib/ai/draft";
import { referencedPeople, scoringRubric } from "../lib/rubric";
import { splitPii } from "../lib/pii";

// Everyone the rubric names: the 8 past hires and the founder.
const people = existsSync("rubric.txt") ? referencedPeople(readFileSync("rubric.txt", "utf8")) : [];
const named = (text: string) => people.filter((p) => new RegExp(`\\b${p}\\b`).test(text));

test("no real person's name in any instruction sent to Gemini", { skip: SKIP }, () => {
  for (const role of ["PM", "SPM"] as const) {
    assert.deepEqual(named(INVITE(role)), [], "invite prompt");
    assert.deepEqual(named(REJECT(role)), [], "reject prompt");
  }
  assert.deepEqual(named(scoringRubric(readFileSync("rubric.txt", "utf8"))), [], "scoring rubric");
  // classify / extract / score prompts are built from template literals in these files
  for (const f of ["lib/ai/classify.ts", "lib/ai/extract.ts", "lib/ai/score.ts"]) {
    const code = readFileSync(f, "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.deepEqual(named(code), [], f);
  }
});

test("the sender signature is filled in locally", { skip: SKIP }, () => {
  const out = personalize("Hi [FIRST_NAME],\nThanks.\nBest,\n[SENDER_SIGNATURE]", splitPii("Asha Rao\na@example.com\n").personal);
  assert.match(out, /^Hi Asha,/);
  assert.match(out, /Best,\nArjun Mehta\nFounder, Kargo$/);
  assert.doesNotMatch(out, /\[[A-Z_]+\]/);
});
