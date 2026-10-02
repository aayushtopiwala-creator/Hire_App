import { Type, type Schema } from "@google/genai";
import { generateJson } from "../gemini";
import type { PersonalDetails, Role, RoleSignals, RoleStatus } from "../types";

export const CLASSIFY_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    stated_role: { type: Type.STRING, enum: ["PM", "SPM", "none"], description: "Only if the CV explicitly says which Kargo role it is applying for." },
    stated_role_quote: { type: Type.STRING, description: "The exact words from the CV stating the role applied for; '' if none." },
    pm_years: { type: Type.NUMBER, description: "Years in product-management roles (PM, APM, Product Owner, Head of Product...). Not total career." },
    total_years: { type: Type.NUMBER },
    most_recent_title: { type: Type.STRING },
    ownership_scope: { type: Type.STRING, description: "One short phrase: what they owned in their most recent role, and whether anyone senior made the product calls above them." },
    guess: { type: Type.STRING, enum: ["PM", "SPM"] },
    confidence: { type: Type.STRING, enum: ["high", "medium", "low"] },
    reason: { type: Type.STRING, description: "One line, ≤ 25 words, citing the deciding evidence." },
  },
  required: ["stated_role", "stated_role_quote", "pm_years", "total_years", "most_recent_title", "ownership_scope", "guess", "confidence", "reason"],
  propertyOrdering: ["stated_role", "stated_role_quote", "pm_years", "total_years", "most_recent_title", "ownership_scope", "guess", "confidence", "reason"],
};

const SYSTEM = `You decide which of two open roles at Kargo (a logistics SaaS company) a CV fits better. You are NOT judging quality — only the level.

- PM (Product Manager): 2–4 years of product management; owns a product area day to day.
- SPM (Senior Product Manager): 5–8 years of product management, with evidence of owning a product area without senior PMs above them making the calls; platform/integration scope; may mentor or shape a PM function.

Rules:
1. If the CV explicitly states which role it is applying for ("Applying for: Senior Product Manager", "Application — Product Manager role"), set stated_role and copy those exact words into stated_role_quote. That decides the guess, whatever the experience says.
2. Otherwise infer from, in order: years of PM experience (not total career — consulting, marketing, engineering, ops years are not PM years), seniority of the most recent title, and the scope of ownership described.
3. confidence: "high" only when the evidence clearly sits inside one band (e.g. 2.5 PM years and a PM title; 7 PM years leading a product area). "medium" when signals point one way but something conflicts (e.g. a senior title with few PM years, or 4–5 PM years). "low" when PM experience is unclear or absent (career switchers, non-PM backgrounds) or signals conflict strongly.
4. Identifiers are redacted ([CANDIDATE], [CONTACT], [LINK], [REFERENCE]); ignore them. Never guess identity.
5. reason: one line naming the deciding evidence, e.g. "~3 PM years, current title Product Manager, owns one product area." Refer to the candidate as "they".`;

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Auto-confirm rule (deliberately conservative; everything else waits for the founder):
 *  (a) the CV explicitly states the role AND that statement is found verbatim in the CV, or
 *  (b) the model says "high" AND PM years sit clearly inside the guessed band, at least half a year
 *      from the 4–5 year boundary: PM ≤ 3.5 years, SPM ≥ 5.5 years.
 */
export function decideRoleStatus(s: Omit<RoleSignals, "auto_rule">, guess: Role): { status: RoleStatus; role: Role | null; rule: string } {
  if (s.stated_role !== "none" && s.stated_quote_verified) {
    return { status: "auto_confirmed", role: s.stated_role, rule: "role stated in CV" };
  }
  if (s.model_confidence === "high") {
    if (guess === "PM" && s.pm_years <= 3.5) return { status: "auto_confirmed", role: "PM", rule: "high confidence, ≤ 3.5 PM years" };
    if (guess === "SPM" && s.pm_years >= 5.5) return { status: "auto_confirmed", role: "SPM", rule: "high confidence, ≥ 5.5 PM years" };
  }
  return { status: "needs_confirmation", role: null, rule: "needs founder confirmation" };
}

export interface ClassifyResult {
  guess: Role;
  confidence: "high" | "medium" | "low";
  reason: string;
  signals: RoleSignals;
  status: RoleStatus;
  role: Role | null;
}

export async function classifyRole(args: { candidateId: string; redactedCv: string; personal: PersonalDetails }): Promise<ClassifyResult> {
  const r = await generateJson<{
    stated_role: Role | "none";
    stated_role_quote: string;
    pm_years: number;
    total_years: number;
    most_recent_title: string;
    ownership_scope: string;
    guess: Role;
    confidence: "high" | "medium" | "low";
    reason: string;
  }>({
    step: "classify",
    candidateId: args.candidateId,
    personal: args.personal,
    systemInstruction: SYSTEM,
    contents: `CV (PII-redacted):\n"""\n${args.redactedCv}\n"""`,
    schema: CLASSIFY_SCHEMA,
    temperature: 0.1,
  });

  // A stated role only counts if its quote is really in the CV.
  const quoteOk = r.stated_role !== "none" && norm(r.stated_role_quote).length >= 6 && norm(args.redactedCv).includes(norm(r.stated_role_quote));
  // Stated role decides the guess (rule 1), but only when verified; an unverified claim falls back to inference.
  const guess: Role = quoteOk ? (r.stated_role as Role) : r.guess;
  const base = {
    stated_role: r.stated_role,
    stated_role_quote: r.stated_role_quote,
    stated_quote_verified: r.stated_role === "none" ? undefined : quoteOk,
    pm_years: Number(r.pm_years) || 0,
    total_years: Number(r.total_years) || 0,
    most_recent_title: r.most_recent_title,
    ownership_scope: r.ownership_scope,
    model_confidence: r.confidence,
  };
  const d = decideRoleStatus(base, guess);
  return {
    guess,
    // An unverified stated role is a conflict worth the founder's eye.
    confidence: r.stated_role !== "none" && !quoteOk ? "low" : r.confidence,
    reason: r.reason.trim(),
    signals: { ...base, auto_rule: d.rule },
    status: d.status,
    role: d.role,
  };
}
