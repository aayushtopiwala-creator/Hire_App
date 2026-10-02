import { Type, type Schema } from "@google/genai";
import { generateJson } from "../gemini";
import { scoringRubric } from "../rubric";
import { CATEGORIES, CATEGORY_META, type Category, type ExtractedProfile, type Justifications, type PersonalDetails, type Role, type Scores } from "../types";

const byCategory = (item: Schema): Schema => ({
  type: Type.OBJECT,
  properties: Object.fromEntries(CATEGORIES.map((c) => [c, item])),
  required: [...CATEGORIES],
  propertyOrdering: [...CATEGORIES],
});

// Matches the OUTPUT FORMAT block of rubric.txt exactly.
export const SCORING_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    category_scores: byCategory({ type: Type.NUMBER }),
    total: { type: Type.NUMBER },
    justifications: byCategory({ type: Type.STRING }),
  },
  required: ["category_scores", "total", "justifications"],
  propertyOrdering: ["category_scores", "total", "justifications"],
};

// The Category A "BOTH" rule replaced "judge ownership_level, not industry", which the model read as
// "industry doesn't matter" (hospital-ward administration scored A=2 on 2026-10-01). Its first version then
// under-credited supply-chain PLANNING (demand/inventory planning scored A=0), so planning is named explicitly.
// The "never upgrade" rule came from Phase 2 testing: the model called an "occasional" blog "active".
// (The short-internship rule that was also here now lives in rubric.txt's Category A anchor 1(b).)
const SYSTEM = (role: Role, rubric: string) => `You score one candidate for Kargo's ${role === "PM" ? "Product Manager (PM)" : "Senior Product Manager (SPM)"} role against the rubric below.

You receive ONLY an extracted_profile JSON (PII-redacted). Rules:
- Score strictly from evidence in extracted_profile. If the evidence for a category is absent, the score is low — never assume.
- Every justification must cite specific evidence from extracted_profile (a role, company type, quote, metric, or the explicit absence of something) and state which score anchor it meets. 1–3 sentences. Never restate the score alone, never invent details.
- Describe evidence in the profile's own terms — never upgrade it (e.g. "writes occasionally" must not become "active blog"; a 3-month internship is not "sustained").
- Quotation marks (single or double) go ONLY around text copied exactly from the CV (evidence_quote / text fields are verbatim). Anything paraphrased, shortened, reworded, or with a pronoun changed must NOT be in quotation marks.
- Refer to the candidate only as "the candidate" or "they/them/their". Never use he, she, him, her, his, hers, himself or herself — not even inside a quotation: if a CV quote contains a gendered pronoun, paraphrase that part instead of quoting it.
- Signals whose quote_verified is false are weak evidence: mention this if you rely on one.
- Category A needs BOTH: (1) the work was hands-on (ownership_level), not advisory/analytical/reporting — surface_technical or non_operational signals score at most 1; AND (2) the work itself was logistics/freight/customs/port/carrier or supply-chain operations — moving, storing, documenting or coordinating physical goods, OR planning their flow (demand/inventory/distribution/carrier planning: the rubric's anchor 3 names supply-chain planning, and a Supply Chain Analyst role is its own Exceeds example). Working at a logistics company in a non-ops function doesn't count, and neither does hands-on work in another kind of operations (e.g. hospital administration, bed allocation, retail store ops) just because inventory is mentioned.${role === "SPM" ? "\n- This is an SPM candidate: apply the stricter SPM reading of Category A (3 requires ops exposure spanning multiple external parties/systems)." : ""}
- Category E: pedigree never substitutes for A/B evidence.
- Allowed values — A: 0,1,2,3 · B: 0,1,2 · C: 0,0.5,1,1.5 · D: 0,0.5,1 · E: 0,0.25,0.5 · F: 0,1,2. total = the sum.

RUBRIC
${rubric}`;

export interface ScoreResult {
  category_scores: Scores;
  total: number;
  justifications: Justifications;
  adjustments: string[];
}

function snap(c: Category, v: number): number {
  const { max, step } = CATEGORY_META[c];
  const n = Number.isFinite(v) ? v : 0;
  return Math.min(max, Math.max(0, Math.round(n / step) * step));
}

/** Enforce the rubric's arithmetic server-side instead of trusting the model with it. */
type RawScore = { category_scores: Scores; total: number; justifications: Justifications };

const normQuote = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[^\p{L}\p{N}%]+/gu, " ").trim();

/** Spans inside "…", “…”, '…' or ‘…' (single quotes only when not an apostrophe inside a word). */
export function quotedSpans(text: string): string[] {
  const re = /"([^"\n]{3,}?)"|“([^”\n]{3,}?)”|(?<![\p{L}\p{N}])'([^'\n]{3,}?)'(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])‘([^’\n]{3,}?)’(?![\p{L}\p{N}])/gu;
  return [...text.matchAll(re)].map((m) => m[1] ?? m[2] ?? m[3] ?? m[4]);
}

/** Quoted spans that aren't verbatim in the CV. "…"/"..." may join verbatim fragments. */
export function misquotes(text: string, cvText: string): string[] {
  const cv = normQuote(cvText);
  return quotedSpans(text).filter((q) => !q.split(/…|\.\.\./).map(normQuote).filter(Boolean).every((part) => cv.includes(part)));
}

export function normalizeScores(raw: RawScore, cvText?: string): ScoreResult {
  const adjustments: string[] = [];
  const scores = {} as Scores;
  for (const c of CATEGORIES) {
    scores[c] = snap(c, raw.category_scores[c]);
    if (scores[c] !== raw.category_scores[c]) adjustments.push(`${c}: ${raw.category_scores[c]} snapped to ${scores[c]}`);
  }
  // Rubric E anchor: 0.5 "counts only alongside evidence in A/B, never alone".
  if (scores.E === 0.5 && scores.A === 0 && scores.B === 0) {
    scores.E = 0.25;
    adjustments.push("E capped at 0.25: no A/B evidence");
  }
  const total = Math.round(CATEGORIES.reduce((s, c) => s + scores[c], 0) * 100) / 100;
  if (Math.abs(total - raw.total) > 0.01) adjustments.push(`total recomputed ${raw.total} -> ${total}`);

  for (const c of CATEGORIES) {
    if (!raw.justifications[c] || raw.justifications[c].trim().length < 20) {
      throw new Error(`Missing or empty justification for category ${c}`);
    }
  }
  const gendered = CATEGORIES.filter((c) => GENDERED.test(raw.justifications[c]));
  if (gendered.length) throw new GenderedPronounError(gendered);
  if (cvText) {
    const bad = CATEGORIES.flatMap((c) => misquotes(raw.justifications[c], cvText).map((q) => ({ c, q })));
    if (bad.length) throw new MisquoteError(bad);
  }
  return { category_scores: scores, total, justifications: raw.justifications, adjustments };
}

const GENDERED = /\b(he|she|him|her|his|hers|himself|herself)\b/i;

export class GenderedPronounError extends Error {
  constructor(public categories: Category[]) {
    super(`Gendered pronoun in justification ${categories.join(", ")}`);
  }
}

export class MisquoteError extends Error {
  constructor(public spans: { c: Category; q: string }[]) {
    super(`Quoted text not verbatim in CV: ${spans.map((x) => `${x.c}: "${x.q}"`).join("; ")}`);
  }
}

/** Last resort after retries: keep the words, drop the quotation marks that claimed they were verbatim. */
export function unquote(text: string, span: string): string {
  for (const [o, c] of [['"', '"'], ["“", "”"], ["'", "'"], ["‘", "’"]]) text = text.replace(`${o}${span}${c}`, span);
  return text;
}

/**
 * Last resort after retries: swap gendered pronouns for singular "they" forms. Verb agreement can
 * come out slightly off ("they is"), which is why this runs only after the model failed twice.
 */
export function neutralize(text: string): string {
  const map: Record<string, string> = {
    he: "they", she: "they", him: "them", his: "their", hers: "theirs", himself: "themself", herself: "themself",
    // "her" is object or possessive; before a word it's almost always possessive ("her personal blog").
  };
  return text
    .replace(/\bher(?=\s+[a-z])/gi, (m) => (m[0] === "H" ? "Their" : "their"))
    .replace(/\b(he|she|him|her|his|hers|himself|herself)\b/gi, (m) => {
      const r = map[m.toLowerCase()] ?? "them";
      return m[0] === m[0].toUpperCase() ? r[0].toUpperCase() + r.slice(1) : r;
    });
}

/** One validated scoring run (retries + deterministic fallbacks for pronouns/quotes). */
async function scoreOnce(args: {
  candidateId: string;
  role: Role;
  profile: ExtractedProfile;
  rubricContent: string;
  personal: PersonalDetails;
  /** Used only to verify quotations locally — never sent to Gemini in this call. */
  redactedCv?: string;
}): Promise<ScoreResult> {
  const call = () =>
    generateJson<RawScore>({
      step: "score",
      candidateId: args.candidateId,
      personal: args.personal,
      systemInstruction: SYSTEM(args.role, scoringRubric(args.rubricContent)),
      contents: `extracted_profile:\n${JSON.stringify(args.profile, null, 2)}`,
      schema: SCORING_SCHEMA,
      temperature: 0.1,
    });

  // Up to two retries for a missing justification (a bare number never ships), a gendered pronoun,
  // or a quotation that isn't verbatim from the CV.
  let raw = await call();
  for (let attempt = 0; ; attempt++) {
    try {
      return normalizeScores(raw, args.redactedCv);
    } catch (e) {
      const retriable = e instanceof GenderedPronounError || e instanceof MisquoteError || (e instanceof Error && e.message.startsWith("Missing or empty justification"));
      if (!retriable) throw e;
      if (attempt < 2) {
        raw = await call();
        continue;
      }
      if (!(e instanceof GenderedPronounError || e instanceof MisquoteError)) throw e;
      // Still failing after two retries: fix deterministically and record exactly what was changed.
      const notes: string[] = [];
      const gendered = CATEGORIES.filter((c) => GENDERED.test(raw.justifications[c]));
      for (const c of gendered) raw.justifications[c] = neutralize(raw.justifications[c]);
      if (gendered.length) notes.push(`pronouns neutralized in ${gendered.join(", ")} after 2 retries`);
      if (args.redactedCv) {
        for (const c of CATEGORIES) {
          for (const q of misquotes(raw.justifications[c], args.redactedCv)) {
            raw.justifications[c] = unquote(raw.justifications[c], q);
            notes.push(`${c}: removed quotation marks from non-verbatim "${q}" after 2 retries`);
          }
        }
      }
      const result = normalizeScores(raw, args.redactedCv);
      result.adjustments.push(...notes);
      return result;
    }
  }
}

/** Median of an odd-length list of numbers. */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * Self-consistent scoring: run the scorer `samples` times (default 3) and take the median of each
 * category. Each category's justification is taken from a run that gave exactly the median score, so
 * text and number always agree. Disagreement between runs is recorded in adjustments for audit.
 * Added 2026-10-01 after the same profile scored C ±0.5 (and once A ±1) between runs.
 */
export async function scoreProfile(args: Parameters<typeof scoreOnce>[0] & { samples?: number }): Promise<ScoreResult> {
  const n = args.samples ?? 3;
  if (n <= 1) return scoreOnce(args);
  const runs = await Promise.all(Array.from({ length: n }, () => scoreOnce(args)));
  const category_scores = {} as Scores;
  const justifications = {} as Justifications;
  const notes: string[] = [];
  for (const c of CATEGORIES) {
    const vals = runs.map((r) => r.category_scores[c]);
    const m = median(vals);
    category_scores[c] = m;
    justifications[c] = runs.find((r) => r.category_scores[c] === m)!.justifications[c];
    if (new Set(vals).size > 1) notes.push(`${c}: runs ${vals.join("/")} → median ${m}`);
  }
  for (const r of runs) notes.push(...r.adjustments);
  // Re-apply the rubric arithmetic (e.g. the E cap depends on A/B) to the combined result.
  const combined = normalizeScores({ category_scores, total: 0, justifications }, args.redactedCv);
  return { ...combined, adjustments: [...new Set([...notes, ...combined.adjustments.filter((a) => !a.startsWith("total recomputed"))])] };
}
