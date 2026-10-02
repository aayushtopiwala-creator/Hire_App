export type Role = "PM" | "SPM";
export const ROLES: Role[] = ["PM", "SPM"];

export type Category = "A" | "B" | "C" | "D" | "E" | "F";
export const CATEGORIES: Category[] = ["A", "B", "C", "D", "E", "F"];

export const CATEGORY_META: Record<Category, { label: string; max: number; step: number }> = {
  A: { label: "Ground-level ops immersion", max: 3, step: 1 },
  B: { label: "Ships and kills things", max: 2, step: 1 },
  C: { label: "Core PM craft", max: 1.5, step: 0.5 },
  D: { label: "Trajectory and stability", max: 1, step: 0.5 },
  E: { label: "Qualifications", max: 0.5, step: 0.25 },
  F: { label: "Personal voice and validation", max: 2, step: 1 },
};

export interface PersonalDetails {
  name: string | null;
  /** How the name was found; "header"/low means AI steps stay blocked until the founder confirms it. */
  name_method?: "label" | "contact_line" | "repeated" | "header" | "founder" | "none";
  name_confidence?: "high" | "low" | "founder" | null;
  /** Probable name words from the file name — a leak tripwire for the Gemini guard, never sent anywhere. */
  tripwire_tokens?: string[];
  email: string | null;
  phone: string | null;
  other_emails: string[];
  other_phones: string[];
  links: string[];
  /** Third-party names (referees, quoted managers) removed from the text. */
  third_party_names: string[];
  warnings: string[];
}

export interface ExtractedProfile {
  years_experience: number;
  roles: { title: string; company: string; duration: string; key_achievement: string }[];
  education: string[];
  certifications: string[];
  professional_achievements: string[];
  ops_immersion_signals: {
    description: string;
    organisation_type: string;
    ownership_level: "hands_on_owner" | "direct_exposure" | "surface_technical" | "non_operational";
    duration: string;
    evidence_quote: string;
    quote_verified?: boolean;
  }[];
  personal_voice_signals: {
    type: "philosophy_statement" | "third_party_quote" | "public_initiative";
    text: string;
    attribution: string;
    quote_verified?: boolean;
  }[];
  shipped_and_killed_evidence: {
    type: "shipped" | "killed" | "reversed" | "post_mortem";
    description: string;
    metric: string;
    evidence_quote: string;
    quote_verified?: boolean;
  }[];
  communication_quality: "clear" | "verbose" | "generic";
  flags: { type: string; detail: string }[];
}

export type Scores = Record<Category, number>;
export type Justifications = Record<Category, string> & { _adjustments?: string[] };

export type RoleStatus = "unclassified" | "needs_confirmation" | "auto_confirmed" | "founder_confirmed" | "applicant_stated";

export interface RoleSignals {
  stated_role: Role | "none";
  stated_role_quote: string;
  stated_quote_verified?: boolean;
  pm_years: number;
  total_years: number;
  most_recent_title: string;
  ownership_scope: string;
  model_confidence: "high" | "medium" | "low";
  auto_rule?: string;
}

export interface CandidateRow {
  id: string;
  /** The CONFIRMED role; null until confirmed. */
  role: Role | null;
  role_status: RoleStatus;
  role_guess: Role | null;
  role_confidence: "high" | "medium" | "low" | null;
  role_reason: string | null;
  role_signals: RoleSignals | null;
  role_confirmed_at: string | null;
  file_hash: string | null;
  file_name: string;
  personal_details: PersonalDetails;
  cv_raw_text: string;
  cv_redacted_text: string;
  extracted_profile: ExtractedProfile | null;
  category_scores: Scores | null;
  score_justifications: Justifications | null;
  total_score: number | null;
  rubric_version_id: string | null;
  brief: string | null;
  email_subject: string | null;
  email_body: string | null;
  email_type: "invite" | "reject" | null;
  email_edited: boolean;
  draft_warnings: string[];
  status: "draft" | "confirmed_sent";
  sent_at: string | null;
  send_started_at: string | null;
  sent_to: string | null;
  resend_message_id: string | null;
  processing_error: string | null;
  created_at: string;
}
