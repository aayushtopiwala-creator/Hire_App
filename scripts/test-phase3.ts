/**
 * Phase 3 test: brief + draft on the 3 synthetic CVs (already scored by test:phase2).
 * Pool per role is tiny, so topN=1 gives: PM -> strong invited, ambiguous rejected; SPM -> weak invited (only one).
 * To exercise a rejection for every profile we also force-draft with topN=0.
 */
import "./_env";
import { personalize } from "../lib/ai/draft";
import { draftCandidate, getCandidate } from "../lib/pipeline";
import { db } from "../lib/supabase";
import { FIXTURES } from "./_fixtures";

async function show(id: string) {
  const c = await getCandidate(id);
  console.log(`\n===== ${c.file_name} (${c.role}, ${c.total_score}/10) -> ${c.email_type}`);
  if (c.brief) console.log(`BRIEF: ${personalize(c.brief, c.personal_details)}`);
  console.log(`SUBJECT: ${c.email_subject}\n${personalize(c.email_body!, c.personal_details)}`);
  if (c.draft_warnings.length) console.log("WARNINGS:", c.draft_warnings);
  return c;
}

async function main() {
  const { data } = await db().from("candidates").select("id, file_name, status").in("file_name", FIXTURES.map((f) => f.file.split("/").pop()!));
  const byFile = Object.fromEntries((data ?? []).map((r) => [r.file_name, r.id]));
  const strong = byFile["strong_pm_neha_kulkarni.pdf"], weak = byFile["weak_spm_karan_malhotra.docx"], amb = byFile["ambiguous_pm_farah_sayed.txt"];
  if (!strong || !weak || !amb) throw new Error("run test:phase2 first");

  let bad = 0;
  await draftCandidate(strong, 1, { force: true });
  const s = await show(strong);
  if (s.email_type !== "invite" || !s.brief) bad++;

  await draftCandidate(amb, 1, { force: true });
  const a = await show(amb);
  if (a.email_type !== "reject" || a.brief) bad++;

  await draftCandidate(weak, 0, { force: true });
  const w = await show(weak);
  if (w.email_type !== "reject") bad++;

  for (const c of [s, a, w]) bad += c.draft_warnings.length;
  // Nothing was sent.
  for (const c of [s, a, w]) if (c.status !== "draft" || c.sent_at) bad++;
  console.log(bad ? `\nPhase 3: ${bad} problem(s)` : "\nPhase 3 PASS (review tone above)");
  if (bad) process.exit(1);
}

main().catch((e) => {
  console.error("Phase 3 FAIL:", e.message);
  process.exit(1);
});
