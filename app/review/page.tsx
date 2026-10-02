import { requireArjun } from "@/lib/auth";
import { ReviewQueue, type ReviewItem } from "@/components/ReviewQueue";
import { personalize } from "@/lib/ai/draft";
import { env } from "@/lib/env";
import { db } from "@/lib/supabase";
import type { CandidateRow } from "@/lib/types";

export const dynamic = "force-dynamic";

/** One screen for the whole review-and-send session: invites first, then rejections. */
export default async function ReviewPage() {
  await requireArjun();
  const { data, error } = await db()
    .from("candidates")
    .select("id, role, file_name, personal_details, total_score, brief, email_subject, email_body, email_type, draft_warnings, status, sent_at, sent_to, send_started_at, created_at")
    .not("email_body", "is", null)
    .order("total_score", { ascending: false })
    .order("created_at", { ascending: true }); // same tie-break as the shortlist and drafting
  if (error) return <p className="error-text">Could not load drafts: {error.message}</p>;
  const rows = data as unknown as CandidateRow[];

  const rankIn: Record<string, number> = { PM: 0, SPM: 0 };
  const items: ReviewItem[] = rows.map((c) => {
    const pd = c.personal_details;
    return {
      id: c.id,
      role: c.role!,
      rank: ++rankIn[c.role!],
      score: Number(c.total_score),
      fileName: c.file_name,
      // Names are joined here, at render time — never sent to Gemini.
      name: pd.name ?? c.file_name,
      email: pd.email,
      brief: c.brief ? personalize(c.brief, pd) : null,
      emailSubject: c.email_subject,
      emailBody: c.email_body ? personalize(c.email_body, pd) : null,
      emailType: c.email_type,
      draftWarnings: c.draft_warnings ?? [],
      status: c.status,
      sentAt: c.sent_at,
      sentTo: c.sent_to,
      sendStartedAt: c.send_started_at,
    };
  });
  // Invites first (PM then SPM, by rank), then rejections in the same order.
  const order = (i: ReviewItem) => (i.emailType === "invite" ? 0 : 1) * 1000 + (i.role === "PM" ? 0 : 500) + i.rank;
  items.sort((a, b) => order(a) - order(b));

  return <ReviewQueue items={items} testRecipient={env.emailTestRecipient()} />;
}
