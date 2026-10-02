import { Type, type Schema } from "@google/genai";
import { generateJson } from "../gemini";
import type { ExtractedProfile, PersonalDetails, Role } from "../types";

const str = (description?: string): Schema => ({ type: Type.STRING, description });
const strArr = (description?: string): Schema => ({ type: Type.ARRAY, items: { type: Type.STRING }, description });
const obj = (properties: Record<string, Schema>): Schema => ({
  type: Type.OBJECT,
  properties,
  required: Object.keys(properties),
  propertyOrdering: Object.keys(properties),
});

export const EXTRACTION_SCHEMA: Schema = obj({
  years_experience: { type: Type.NUMBER, description: "Total years of professional (post-education) experience." },
  roles: {
    type: Type.ARRAY,
    items: obj({
      title: str(),
      company: str("Company name plus sector in brackets if stated, e.g. 'Dockline (freight SaaS)'."),
      duration: str("As written, plus computed length, e.g. 'Jan 2023 – Present (2y 9m)'."),
      key_achievement: str("The single most concrete outcome in this role, with numbers if present; '' if none stated."),
    }),
  },
  education: strArr("Degree, institution, year."),
  certifications: strArr(),
  professional_achievements: strArr("Specific, quantified outcomes anywhere in the CV."),
  ops_immersion_signals: {
    type: Type.ARRAY,
    description:
      "Hands-on work INSIDE freight-forwarding / customs / port / terminal / shipping line / carrier / supply-chain operations. " +
      "Include weak or non-operational logistics touches too, labelled with the right ownership_level, so scoring can discount them.",
    items: obj({
      description: str("What they actually did, in operational terms."),
      organisation_type: {
        type: Type.STRING,
        enum: ["CHA", "freight_forwarder", "NVOCC", "port_terminal", "shipping_line", "carrier", "3PL_warehouse", "supply_chain_planning", "logistics_software", "other"],
      },
      ownership_level: {
        type: Type.STRING,
        enum: ["hands_on_owner", "direct_exposure", "surface_technical", "non_operational"],
        description:
          "hands_on_owner = personally did documentation/clearance/carrier coordination/terminal ops/planning as their job for a sustained period; " +
          "direct_exposure = real but short, early, or one step removed (internship, shadowing, sitting with ops teams as a PM); " +
          "surface_technical = only an API/integration touch; non_operational = worked at a logistics company in a non-ops function.",
      },
      duration: str("How long, as stated or computed; '' if unknown."),
      evidence_quote: str("Verbatim phrase copied from the CV text supporting this signal."),
    }),
  },
  personal_voice_signals: {
    type: Type.ARRAY,
    items: obj({
      type: { type: Type.STRING, enum: ["philosophy_statement", "third_party_quote", "public_initiative"] },
      text: str("Verbatim from the CV."),
      attribution: str("For third_party_quote: the person's role (names are redacted). Otherwise ''."),
    }),
  },
  shipped_and_killed_evidence: {
    type: Type.ARRAY,
    items: obj({
      type: { type: Type.STRING, enum: ["shipped", "killed", "reversed", "post_mortem"] },
      description: str(),
      metric: str("The number attached, or '' if none."),
      evidence_quote: str("Verbatim phrase copied from the CV text."),
    }),
  },
  communication_quality: { type: Type.STRING, enum: ["clear", "verbose", "generic"] },
  flags: {
    type: Type.ARRAY,
    items: obj({
      type: { type: Type.STRING, enum: ["employment_gap", "short_stint", "job_hopping", "vague_duties", "no_metrics", "title_inflation", "experience_below_band", "experience_above_band", "other"] },
      detail: str(),
    }),
  },
});

const ROLE_BAND: Record<Role, string> = { PM: "2–4 years of PM experience", SPM: "5–8 years of PM experience" };

const SYSTEM = (role: Role) => `You extract structured facts from a CV for Kargo, a logistics SaaS company (freight forwarders, 3PLs), hiring a ${role === "PM" ? "Product Manager" : "Senior Product Manager"} (${ROLE_BAND[role]}).

Rules:
- Extract ONLY what the CV states. Never infer, embellish, or fill gaps. An empty array is a correct answer.
- evidence_quote and personal voice "text" must be copied verbatim from the CV (a short phrase is fine).
- Identifiers are redacted: [CANDIDATE] is the candidate, [REFERENCE] a third party, [CONTACT]/[LINK] contact details. Keep placeholders as-is; never guess what they hide.
- ops_immersion_signals is about operational immersion, not industry. Being a PM at a logistics SaaS company is not hands-on ops unless the CV describes doing or directly sitting in the operational work. Label honestly with ownership_level.
- personal_voice_signals: philosophy_statement = a distinct first-person view on how they work (not generic adjectives like "results-driven, passionate"); third_party_quote = someone else's quoted words about them; public_initiative = talks, published writing, open source.
- shipped_and_killed_evidence: "killed"/"reversed"/"post_mortem" only when the CV explicitly describes stopping, reversing, or learning from a failure.
- communication_quality: "generic" if mostly boilerplate duties/adjectives, "verbose" if padded, "clear" if specific and concise.
- flags: gaps > 6 months, stints < 12 months, 3+ jobs in 3 years, experience outside ${ROLE_BAND[role]}, vague duties.`;

/** Normalise for a forgiving "is this quote really in the CV" check. */
const norm = (s: string) => s.toLowerCase().replace(/[“”"'’]/g, "").replace(/[^\p{L}\p{N}%]+/gu, " ").trim();

function verified(quote: string, cvNorm: string): boolean {
  const q = norm(quote);
  if (q.length < 8) return false;
  if (cvNorm.includes(q)) return true;
  // Allow light trimming by the model: accept if 90% of the quote's words appear in order-agnostic form.
  const words = q.split(" ");
  return words.filter((w) => cvNorm.includes(w)).length / words.length >= 0.9;
}

export async function extractProfile(args: {
  candidateId: string;
  role: Role;
  redactedCv: string;
  personal: PersonalDetails;
}): Promise<ExtractedProfile> {
  const profile = await generateJson<ExtractedProfile>({
    step: "extract",
    candidateId: args.candidateId,
    personal: args.personal,
    systemInstruction: SYSTEM(args.role),
    contents: `Role applied for: ${args.role}\n\nCV (PII-redacted):\n"""\n${args.redactedCv}\n"""`,
    schema: EXTRACTION_SCHEMA,
    temperature: 0.1,
  });

  // Grounding check: mark every quote as verified/unverified against the redacted CV so the UI can show it.
  const cvNorm = norm(args.redactedCv);
  for (const s of profile.ops_immersion_signals) s.quote_verified = verified(s.evidence_quote, cvNorm);
  for (const s of profile.shipped_and_killed_evidence) s.quote_verified = verified(s.evidence_quote, cvNorm);
  for (const s of profile.personal_voice_signals) s.quote_verified = verified(s.text, cvNorm);
  return profile;
}
