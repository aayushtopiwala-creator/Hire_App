import { classifyRole } from "./ai/classify";
import { extractProfile } from "./ai/extract";
import { draftEmail } from "./ai/draft";
import { scoreProfile } from "./ai/score";
import { latestRubric } from "./rubric";
import { db } from "./supabase";
import { splitPii } from "./pii";
import type { CandidateRow, Role } from "./types";

export async function getCandidate(id: string): Promise<CandidateRow> {
  const { data, error } = await db().from("candidates").select("*").eq("id", id).single();
  if (error) throw new Error(`candidate ${id}: ${error.message}`);
  return data as CandidateRow;
}

/** Role step: guess PM/SPM from the redacted CV. Auto-confirms only under the rule in decideRoleStatus. */
export async function classifyCandidate(id: string): Promise<CandidateRow> {
  const c = await getCandidate(id);
  // A role the founder set, or the applicant stated, is never overwritten by the model.
  if (c.role_status === "founder_confirmed" || c.role_status === "applicant_stated") return c;
  try {
    const r = await classifyRole({ candidateId: id, redactedCv: c.cv_redacted_text, personal: c.personal_details });
    await update(id, {
      role_guess: r.guess,
      role_confidence: r.confidence,
      role_reason: r.reason,
      role_signals: r.signals,
      role_status: r.status,
      role: r.role,
      role_confirmed_at: r.role ? new Date().toISOString() : null,
      processing_error: null,
    });
  } catch (e) {
    await update(id, { processing_error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
  return getCandidate(id);
}

// Everything derived from a role-specific pass; cleared when the role changes.
const ROLE_DERIVED_RESET: Partial<CandidateRow> = {
  extracted_profile: null,
  category_scores: null,
  score_justifications: null,
  total_score: null,
  rubric_version_id: null,
  brief: null,
  email_subject: null,
  email_body: null,
  email_type: null,
  email_edited: false,
  draft_warnings: [],
};

/** Founder confirms or flips the role. Flipping a scored candidate clears its scores and drafts. */
export async function confirmRole(id: string, role: Role): Promise<CandidateRow> {
  const c = await getCandidate(id);
  if (c.status === "confirmed_sent") throw new Error("an email was already sent — the role can't change now");
  const changed = c.role !== role;
  await update(id, {
    role,
    role_status: "founder_confirmed",
    role_confirmed_at: new Date().toISOString(),
    ...(changed ? ROLE_DERIVED_RESET : {}),
  });
  return getCandidate(id);
}

/** Founder enters/corrects the candidate's name: re-runs redaction and clears anything an AI saw before. */
export async function setCandidateName(id: string, name: string): Promise<CandidateRow> {
  const c = await getCandidate(id);
  if (c.status === "confirmed_sent") throw new Error("an email was already sent — details are locked");
  const { personal, redacted } = splitPii(c.cv_raw_text, { name, fileName: c.file_name });
  const founderRole = c.role_status === "founder_confirmed" || c.role_status === "applicant_stated";
  await update(id, {
    personal_details: personal,
    cv_redacted_text: redacted,
    ...ROLE_DERIVED_RESET,
    // A model guess was made on the old redaction; redo it. A founder-picked role stands.
    ...(founderRole ? {} : { role: null, role_status: "unclassified", role_guess: null, role_confidence: null, role_reason: null, role_signals: null, role_confirmed_at: null }),
  });
  return getCandidate(id);
}

/** AI calls 1 + 2. Idempotent: skips extraction if a profile exists unless `force`. */
export async function processCandidate(id: string, opts: { force?: boolean } = {}): Promise<CandidateRow> {
  const c = await getCandidate(id);
  // Role-specific scoring only runs on a confirmed role.
  if (!c.role) throw new Error("role not confirmed yet — confirm PM or SPM first");
  const role = c.role;
  try {
    let profile = c.extracted_profile;
    if (!profile || opts.force) {
      profile = await extractProfile({ candidateId: c.id, role, redactedCv: c.cv_redacted_text, personal: c.personal_details });
      await update(id, { extracted_profile: profile });
    }
    const rubric = await latestRubric(role);
    const s = await scoreProfile({ candidateId: c.id, role, profile, rubricContent: rubric.content, personal: c.personal_details, redactedCv: c.cv_redacted_text });
    await update(id, {
      category_scores: s.category_scores,
      score_justifications: s.adjustments.length ? { ...s.justifications, _adjustments: s.adjustments } : s.justifications,
      total_score: s.total,
      rubric_version_id: rubric.id,
      processing_error: null,
    });
  } catch (e) {
    await update(id, { processing_error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
  return getCandidate(id);
}

export async function update(id: string, patch: Partial<CandidateRow>) {
  const { error } = await db().from("candidates").update(patch).eq("id", id);
  if (error) throw new Error(`update ${id}: ${error.message}`);
}

export interface Ranked {
  id: string;
  rank: number;
  total: number;
}

/** Ranking within a role: total_score desc, earliest upload first on ties. */
export async function rankRole(role: Role): Promise<{ ranked: Ranked[]; unscored: number }> {
  const { data, error } = await db()
    .from("candidates")
    .select("id, total_score, created_at")
    .eq("role", role)
    .order("total_score", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const scored = data.filter((r) => r.total_score !== null);
  return {
    ranked: scored.map((r, i) => ({ id: r.id, rank: i + 1, total: Number(r.total_score) })),
    unscored: data.length - scored.length,
  };
}

export type DraftOutcome = "drafted" | "skipped_sent" | "skipped_edited" | "unchanged";

/**
 * AI call 3 for one candidate. Top N in their role get an invite + brief, everyone else a rejection.
 * Never sends anything — only writes a draft. Confirmed candidates are never touched; founder-edited
 * drafts are kept unless `force`.
 */
export async function draftCandidate(id: string, topN: number, opts: { force?: boolean } = {}): Promise<DraftOutcome> {
  const c = await getCandidate(id);
  if (c.status === "confirmed_sent") return "skipped_sent";
  if (!c.extracted_profile || !c.category_scores || c.total_score === null) throw new Error("candidate not scored yet");
  if (!c.role) throw new Error("role not confirmed yet");
  const role = c.role;

  const { ranked, unscored } = await rankRole(role);
  // Ranks aren't final while anyone in the role is unscored, so invite/reject would be premature.
  if (unscored > 0) throw new Error(`${unscored} ${role} candidate(s) still unscored — score them before drafting`);
  // A candidate still waiting for a role could land in this pool and change the ranks.
  const { count: unrouted } = await db().from("candidates").select("id", { count: "exact", head: true }).is("role", null);
  if (unrouted) throw new Error(`${unrouted} candidate(s) still need a confirmed role — finish role review before drafting`);
  const me = ranked.find((r) => r.id === id)!;
  const type = me.rank <= topN ? "invite" : "reject";

  if (!opts.force && c.email_body && c.email_type === type) return "unchanged";
  if (!opts.force && c.email_edited) return "skipped_edited";

  const d = await draftEmail({
    candidateId: id,
    role,
    type,
    rank: me.rank,
    poolSize: ranked.length,
    topN,
    profile: c.extracted_profile,
    scores: c.category_scores,
    justifications: c.score_justifications!,
    total: Number(c.total_score),
    personal: c.personal_details,
    redactedCv: c.cv_redacted_text,
  });
  await update(id, {
    email_type: type,
    brief: d.brief,
    email_subject: d.email_subject,
    email_body: d.email_body,
    email_edited: false,
    draft_warnings: d.warnings,
  });
  return "drafted";
}
