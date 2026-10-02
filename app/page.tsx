import { requireArjun } from "@/lib/auth";
import { Dashboard, type CandidateView } from "@/components/Dashboard";
import { RoleReview, type ReviewView } from "@/components/RoleReview";
import type { TabKey } from "@/components/Tabs";
import { personalize } from "@/lib/ai/draft";
import { env } from "@/lib/env";
import { listApplicationFiles } from "@/lib/ingest";
import { suggestTopN } from "@/lib/shortlist";
import { db } from "@/lib/supabase";
import type { CandidateRow, Role } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ role?: string; n?: string }> }) {
  await requireArjun();
  const sp = await searchParams;
  const n = Number(sp.n);
  const nOverride = sp.n !== undefined && Number.isInteger(n) && n >= 0 && n <= 60 ? n : null;
  let topN = nOverride ?? env.topNDefault();

  const { data, error } = await db()
    .from("candidates")
    // cv_raw_text stays on the server; nothing on this page needs it.
    .select("id, role, role_status, role_guess, role_confidence, role_reason, role_signals, file_name, personal_details, extracted_profile, category_scores, score_justifications, total_score, brief, email_subject, email_body, email_type, email_edited, draft_warnings, status, sent_at, sent_to, send_started_at, processing_error, created_at")
    .order("total_score", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (error) {
    return <p className="error-text">Could not load candidates: {error.message}</p>;
  }
  const rows = data as unknown as CandidateRow[];

  // In review: no confirmed role yet, a name that isn't confirmed, or auto-confirmed but not yet scored
  // (so the founder can still overrule the model before scoring spends anything).
  const nameOk = (c: CandidateRow) => !!c.personal_details.name && c.personal_details.name_confidence !== "low";
  const inReview = (c: CandidateRow) => !c.role || !nameOk(c) || (c.role_status === "auto_confirmed" && c.total_score === null);
  const reviewRows = rows.filter(inReview);
  const counts: Record<TabKey, number> = {
    REVIEW: reviewRows.filter((c) => !c.role || !nameOk(c)).length,
    PM: rows.filter((c) => c.role === "PM").length,
    SPM: rows.filter((c) => c.role === "SPM").length,
  };

  const tab: TabKey = sp.role === "PM" || sp.role === "SPM" || sp.role === "REVIEW" ? sp.role : counts.REVIEW > 0 ? "REVIEW" : "PM";
  if (tab === "REVIEW") {
    const order = (c: CandidateRow) =>
      !nameOk(c) ? 0 : c.role_confidence === "low" && !c.role ? 1 : c.role_status === "needs_confirmation" ? 2 : c.role_status === "unclassified" ? 3 : 4;
    const items: ReviewView[] = reviewRows
      .sort((a, b) => order(a) - order(b) || a.file_name.localeCompare(b.file_name))
      .map((c) => ({
        id: c.id,
        name: c.personal_details.name ?? c.file_name,
        nameOk: nameOk(c),
        nameMethod: c.personal_details.name_method ?? null,
        fileName: c.file_name,
        roleStatus: c.role_status,
        role: c.role,
        guess: c.role_guess,
        confidence: c.role_confidence,
        reason: c.role_reason,
        signals: c.role_signals,
        error: c.processing_error,
      }));
    let folderFiles = 0;
    try {
      folderFiles = listApplicationFiles().length;
    } catch {
      // applications/ missing — the import button will report it.
    }
    return <RoleReview counts={counts} topN={topN} items={items} folderFiles={folderFiles} />;
  }
  const role: Role = tab;
  // Shortlist size: the pool's natural score break unless the founder typed a size (?n=).
  const poolScores = rows.filter((c) => c.role === role && c.total_score !== null).map((c) => Number(c.total_score));
  const suggestion = poolScores.length ? suggestTopN(poolScores, env.topNDefault()) : null;
  if (nOverride === null && suggestion) topN = suggestion.n;
  const shortlistNote = suggestion
    ? `Natural break: #${suggestion.n} ${suggestion.above} → #${suggestion.n + 1} ${suggestion.below ?? "—"} (gap ${suggestion.gap})` +
      (nOverride !== null && nOverride !== suggestion.n ? ` · you set ${nOverride}` : "")
    : null;

  let rank = 0;
  const candidates: CandidateView[] = rows
    .filter((c) => c.role === role)
    .map((c) => {
      const scored = c.total_score !== null;
      const pd = c.personal_details;
      return {
        id: c.id,
        rank: scored ? ++rank : null,
        // The name is joined here, at render time, from personal_details — it never goes to Gemini.
        name: pd.name ?? c.file_name,
        nameDetected: !!pd.name,
        email: pd.email,
        fileName: c.file_name,
        piiWarnings: pd.warnings,
        profile: c.extracted_profile && JSON.parse(personalize(JSON.stringify(c.extracted_profile), pd)),
        scores: c.category_scores,
        justifications: c.score_justifications,
        total: scored ? Number(c.total_score) : null,
        brief: c.brief ? personalize(c.brief, pd) : null,
        emailSubject: c.email_subject,
        emailBody: c.email_body ? personalize(c.email_body, pd) : null,
        emailType: c.email_type,
        emailEdited: c.email_edited,
        draftWarnings: c.draft_warnings ?? [],
        status: c.status,
        sentAt: c.sent_at,
        sendStartedAt: c.send_started_at,
        sentTo: c.sent_to,
        error: c.processing_error,
        roleStatus: c.role_status,
        roleNote:
          c.role_status === "founder_confirmed"
            ? "confirmed by you"
            : c.role_status === "applicant_stated"
            ? "stated by the applicant (file name)"
            : `auto-confirmed — ${c.role_signals?.auto_rule ?? "classifier"}${c.role_reason ? ` (${c.role_reason})` : ""}`,
      };
    });

  return <Dashboard role={role} topN={topN} shortlistNote={shortlistNote} counts={counts} candidates={candidates} testRecipient={env.emailTestRecipient()} />;
}
