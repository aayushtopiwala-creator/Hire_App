import { Type, type Schema } from "@google/genai";
import { env } from "../env";
import { generateJson } from "../gemini";
import { misquotes } from "./score";
import type { ExtractedProfile, Justifications, PersonalDetails, Role, Scores } from "../types";

export type EmailType = "invite" | "reject";

export const DRAFT_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    brief: { type: Type.STRING, description: "Invite only: exactly 3 sentences for the founder. '' for reject." },
    email_subject: { type: Type.STRING },
    email_body: { type: Type.STRING },
    referenced_details: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "The 1–2 specific facts from the profile the email refers to, each as a short phrase copied from the profile.",
    },
  },
  required: ["brief", "email_subject", "email_body", "referenced_details"],
  propertyOrdering: ["brief", "email_subject", "email_body", "referenced_details"],
};

const ROLE_NAME: Record<Role, string> = { PM: "Product Manager", SPM: "Senior Product Manager" };

// No personal name reaches Gemini — not even the founder's: the sign-off is a placeholder filled locally.
const COMMON = `You write on behalf of Kargo's founder — Kargo is a Series A, 40-person Mumbai company building software for mid-sized freight forwarders and 3PLs (shipment tracking, documentation, carrier coordination). Roles are in-office in Mumbai.

Placeholders — the candidate's identity is withheld from you on purpose:
- Greet with exactly "Hi [FIRST_NAME]," — it is filled in later. Never use [CANDIDATE] or [REFERENCE] in the email.
- Sign off exactly: "Best,\\n[SENDER_SIGNATURE]" — it is filled in later.

Voice: a founder writing personally — plain, warm, direct, short paragraphs. No corporate filler ("we were impressed by your impressive profile"), no exclamation marks, no emojis.
Pronouns: in the brief, refer to the candidate only as "the candidate" or "they" — never he/she/him/her/his.
Quotation marks only around words copied exactly from the profile's quoted CV text; otherwise paraphrase without quotes.
Grounding: every specific detail must come from the profile you are given. Never invent employers, numbers, or events. Don't mention scores, rankings, rubrics, AI, or automated screening.
referenced_details: list the 1–2 profile facts you actually used, copied as short phrases from the profile.`;

export const INVITE = (role: Role) => `${COMMON}

Task: an interview INVITE for the ${ROLE_NAME[role]} role, plus a brief for the founder.
Email: reference 1–2 specific things from their background that make Kargo want to talk to them, say why they matter to Kargo's work, and ask for two or three times over the next week that suit them for a first conversation. Don't propose specific dates. 90–160 words.
Subject: specific to them, not "Interview invitation".
Brief (for the founder only, not the candidate): exactly 3 sentences. 1) Who they are (use "The candidate"). 2) Why they ranked here, citing the strongest rubric evidence. 3) What to probe in the interview — the weakest or least-evidenced area.`;

export const REJECT = (role: Role) => `${COMMON}

Task: a respectful REJECTION for the ${ROLE_NAME[role]} role. brief must be "".
Email: thank them, reference one real, specific thing from their background with genuine appreciation, say clearly that Kargo won't be moving forward for this role — honest but kind. Give NO reason tied to their experience or profile: no "we're looking for someone with more X", no "this role is scoped differently from what you bring", no over- or under-qualification. A plain decision sentence ("we've decided not to move forward with your application for this role") is the honest version. No false promises (no "we'll keep your CV on file" or "we'll be in touch about future roles"). 70–130 words. Subject: short and plain.`;

export interface DraftResult {
  brief: string | null;
  email_subject: string;
  email_body: string;
  warnings: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}%]+/gu, " ").trim();

/** A referenced detail counts as grounded if most of its words appear in the source text. */
function grounded(detail: string, source: string, threshold = 0.75): boolean {
  const words = norm(detail).split(" ").filter((w) => w.length > 2);
  if (!words.length) return false;
  const src = norm(source);
  return words.filter((w) => src.includes(w)).length / words.length >= threshold;
}

const GENDERED = /\b(he|she|him|her|his|hers|himself|herself)\b/i;
// Rejections give no experience-based reason ("looking for someone with more X", "scoped differently from the
// leadership you bring"): the real reasons are rubric categories, and a paraphrase of them is either a verdict or,
// as a reviewed draft showed (an "overqualified" framing for a candidate rejected on ops evidence), simply untrue.
export const REJECTION_REASON = /\b(?:looking for|focus(?:ed|ing)(?: our search)? on|seeking|need(?:s)?|requires?|required)\b[^.]{0,60}\b(?:experience|background|profile|candidates?|someone|depth|skills?)\b|\b(?:over-?qualified|under-?qualified|scoped differently|more (?:prior|direct|relevant|senior)|less (?:senior|experienced)|depth of (?:leadership|experience)|not the right fit for your)\b/i;

// The candidate must never learn they were machine-scored or ranked.
const SCREENING_WORDS = /\b(rubric|scor(?:e|es|ed|ing)|rank(?:ed|ing|s)?|shortlist(?:ed)?|automated|algorithm|screening (?:tool|system)|out of 10|\/10)\b/i;

export function checkDraft(
  type: EmailType,
  d: { brief: string; email_subject: string; email_body: string; referenced_details: string[] },
  profileJson: string,
  redactedCv?: string,
): string[] {
  const problems: string[] = [];
  if (GENDERED.test(d.brief)) problems.push("gendered pronoun in brief");
  if (SCREENING_WORDS.test(d.email_subject + " " + d.email_body)) problems.push("email mentions scoring/ranking/screening");
  if (type === "reject" && REJECTION_REASON.test(d.email_body)) problems.push(`rejection gives an experience-based reason: "${d.email_body.match(REJECTION_REASON)![0]}"`);
  if (redactedCv) {
    for (const q of [...misquotes(d.email_body, redactedCv), ...misquotes(d.brief, redactedCv)]) problems.push(`quoted text not verbatim in CV: "${q}"`);
  }
  if (!d.email_body.includes("[FIRST_NAME]")) problems.push("missing [FIRST_NAME] greeting");
  if (/\[(CANDIDATE|REFERENCE|CONTACT|LINK)\]/.test(d.email_subject + d.email_body)) problems.push("placeholder leaked into email");
  if (!d.referenced_details.length) problems.push("no specific detail referenced (generic)");
  for (const r of d.referenced_details) {
    if (!grounded(r, profileJson)) problems.push(`referenced detail not in profile: "${r}"`);
    // Looser: the email may paraphrase a detail ("brought failures down" for "from 9% to 2%").
    else if (!grounded(r.replace(/\([^)]*\)/g, " "), d.email_body, 0.5)) problems.push(`referenced detail not used in email: "${r}"`);
  }
  if (type === "invite") {
    const sentences = d.brief.trim().split(/(?<=[.!?])\s+(?=[A-Z[])/).filter(Boolean);
    if (sentences.length !== 3) problems.push(`brief has ${sentences.length} sentences, expected 3`);
  }
  return problems;
}

export async function draftEmail(args: {
  candidateId: string;
  role: Role;
  type: EmailType;
  rank: number;
  poolSize: number;
  topN: number;
  profile: ExtractedProfile;
  scores: Scores;
  justifications: Justifications;
  total: number;
  personal: PersonalDetails;
  /** Used only to check quotations locally — never sent. */
  redactedCv?: string;
}): Promise<DraftResult> {
  const profileJson = JSON.stringify(args.profile, null, 2);
  const { _adjustments, ...justifications } = args.justifications;
  const contents =
    `Email type: ${args.type}\n` +
    (args.type === "invite"
      ? `Rank: ${args.rank} of ${args.poolSize} ${args.role} applicants (interview shortlist = top ${args.topN}). Total ${args.total}/10.\n` +
        `Category scores: ${JSON.stringify(args.scores)}\nJustifications: ${JSON.stringify(justifications, null, 2)}\n`
      : "") +
    `\nextracted_profile:\n${profileJson}`;

  const call = () =>
    generateJson<{ brief: string; email_subject: string; email_body: string; referenced_details: string[] }>({
      step: "draft",
      candidateId: args.candidateId,
      personal: args.personal,
      systemInstruction: args.type === "invite" ? INVITE(args.role) : REJECT(args.role),
      contents,
      schema: DRAFT_SCHEMA,
      temperature: 0.6,
    });

  let d = await call();
  let problems = checkDraft(args.type, d, profileJson, args.redactedCv);
  if (problems.length) {
    // One retry; if it's still off, keep the better draft and surface the warnings to the founder.
    const retry = await call();
    const retryProblems = checkDraft(args.type, retry, profileJson, args.redactedCv);
    if (retryProblems.length < problems.length) [d, problems] = [retry, retryProblems];
  }
  return {
    brief: args.type === "invite" ? d.brief.trim() : null,
    email_subject: d.email_subject.trim(),
    email_body: d.email_body.trim(),
    warnings: problems,
  };
}

/** Fill placeholders locally, at render/send time. Names never go to Gemini. */
export function personalize(text: string, personal: PersonalDetails): string {
  const first = personal.name?.split(/\s+/)[0] ?? "there";
  return text
    .replaceAll("[FIRST_NAME]", first)
    .replaceAll("[CANDIDATE]", personal.name ?? "The candidate")
    .replaceAll("[SENDER_SIGNATURE]", env.senderSignature());
}
