import assert from "node:assert/strict";
import { test } from "node:test";
import { GenderedPronounError, neutralize, normalizeScores } from "../lib/ai/score";

const j = (over: Partial<Record<string, string>> = {}) => ({
  A: "Evidence for A from the profile here.", B: "Evidence for B from the profile here.",
  C: "Evidence for C from the profile here.", D: "Evidence for D from the profile here.",
  E: "Evidence for E from the profile here.", F: "Evidence for F from the profile here.", ...over,
});
const scores = { A: 1, B: 2, C: 1, D: 1, E: 0, F: 2 };

test("gendered pronouns in a justification are rejected", () => {
  assert.throws(() => normalizeScores({ category_scores: scores, total: 7, justifications: j({ F: "A public initiative ('writes about product on her personal blog')." }) as never }), GenderedPronounError);
  assert.throws(() => normalizeScores({ category_scores: scores, total: 7, justifications: j({ A: "He ran customs clearance for two years." }) as never }), GenderedPronounError);
});

test("words containing pronoun letters are not false positives", () => {
  const r = normalizeScores({ category_scores: scores, total: 7, justifications: j({ C: "They led the whole team; theirs was the other approach. Heroes, shepherd, history, therapy." }) as never });
  assert.equal(r.total, 7);
});

test("neutralize fallback", () => {
  assert.equal(neutralize("writes about product on her personal blog"), "writes about product on their personal blog");
  assert.equal(neutralize("His manager praised him"), "Their manager praised them");
  assert.doesNotMatch(neutralize("She said her team trusted her."), /\b(she|her)\b/i);
});

import { misquotes, quotedSpans, unquote } from "../lib/ai/score";

const CV = "About me\nI like problems where the users are busier than the software.\nWrites occasionally about product on her personal blog.";

test("quoted spans: double, curly and single quotes, but not apostrophes", () => {
  assert.deepEqual(quotedSpans(`a "one two" b “three four” c 'five six' the candidate's don't`), ["one two", "three four", "five six"]);
});

test("verbatim quotes pass; reworded quotes are flagged", () => {
  assert.deepEqual(misquotes("statement ('I like problems where the users are busier than the software')", CV), []);
  assert.deepEqual(misquotes("initiative ('Writes occasionally about product on their personal blog')", CV), ["Writes occasionally about product on their personal blog"]);
  assert.deepEqual(misquotes("initiative ('writes occasionally about product')", CV), []); // a verbatim fragment is fine
  assert.deepEqual(misquotes("an unquoted paraphrase: they write occasionally on a blog", CV), []);
});

test("unquote keeps the words and drops the marks", () => {
  assert.equal(unquote("an initiative ('writes on their blog')", "writes on their blog"), "an initiative (writes on their blog)");
});

test("normalizeScores on a combined median result keeps the E cap", () => {
  const r = normalizeScores({ category_scores: { A: 0, B: 0, C: 1, D: 1, E: 0.5, F: 0 }, total: 0, justifications: j() as never });
  assert.equal(r.category_scores.E, 0.25);
  assert.equal(r.total, 2.25);
});
