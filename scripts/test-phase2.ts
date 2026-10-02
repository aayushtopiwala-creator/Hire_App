/** Phase 2 test: extraction + scoring on the 3 synthetic CVs; checks sanity against rubric.txt and the PII audit. */
import "./_env";
import { findPii } from "../lib/pii";
import { processCandidate } from "../lib/pipeline";
import { db } from "../lib/supabase";
import { CATEGORIES } from "../lib/types";
import { referencedPeople } from "../lib/rubric";
import { FIXTURES, freshFixtures } from "./_fixtures";

/**
 *   default:     delete + re-ingest the 3 fixtures, then extract + score.
 *   --rescore:   keep existing rows and their extracted profiles; re-run scoring only
 *                (isolates a rubric change from extraction variance; keeps sent rows' history).
 */
const RESCORE = process.argv.includes("--rescore");

async function existingFixtures(): Promise<{ id: string; label: string }[]> {
  const out = [];
  for (const f of FIXTURES) {
    const { data, error } = await db().from("candidates").select("id").eq("file_name", f.file.split("/").pop()!).single();
    if (error) throw new Error(`${f.file}: ${error.message} — run without --rescore first`);
    out.push({ id: data.id, label: f.label });
  }
  return out;
}

async function main() {
  const started = new Date().toISOString();
  const rows = RESCORE ? await existingFixtures() : await freshFixtures();
  const { data: rubricRows } = await db().from("rubric_versions").select("content").order("created_at", { ascending: false }).limit(1);
  const hireNames = referencedPeople(rubricRows![0].content);
  const totals: Record<string, number> = {};
  let failed = false;

  for (const { id, label } of rows) {
    const c = await processCandidate(id);
    totals[label] = c.total_score!;
    console.log(`\n===== ${label}  (${c.role})  total ${c.total_score}/10`);
    const p = c.extracted_profile!;
    console.log(`profile: ${p.years_experience}y · ${p.roles.length} roles · ops ${p.ops_immersion_signals.map((s) => `${s.ownership_level}${s.quote_verified ? "" : "(unverified)"}`).join(",") || "none"} · voice ${p.personal_voice_signals.map((s) => s.type).join(",") || "none"} · shipped/killed ${p.shipped_and_killed_evidence.map((s) => s.type).join(",") || "none"} · ${p.communication_quality}`);
    for (const k of CATEGORIES) console.log(`  ${k} ${c.category_scores![k]}  ${c.score_justifications![k]}`);
    if (c.score_justifications!._adjustments) console.log("  adjustments:", c.score_justifications!._adjustments);

    // Audit only the calls made by this run.
    const { data: calls } = await db().from("ai_calls").select("step, status, model, contents, system_instruction, pii_check").eq("candidate_id", id).gte("created_at", started).order("created_at");
    for (const call of calls ?? []) {
      const payload = call.contents + "\n" + call.system_instruction;
      const recheck = findPii(call.contents, c.personal_details, call.system_instruction);
      const pd = c.personal_details;
      const idsInPayload = [pd.name, pd.email, pd.phone, ...pd.links, ...pd.third_party_names].filter((v): v is string => !!v && payload.includes(v));
      const hiresInPayload = hireNames.filter((n) => new RegExp(`\\b${n}\\b`).test(payload));
      console.log(`  audit ${call.step}: ${call.status} via ${call.model} · guard ${call.pii_check.ok ? "clean" : "LEAK"} · recheck ${recheck.ok ? "clean" : "LEAK"} · candidate identifiers in payload: ${idsInPayload.length} · hire names in payload: ${hiresInPayload.length ? hiresInPayload.join(",") : 0}`);
      if (!recheck.ok || idsInPayload.length || hiresInPayload.length || call.status !== "ok") failed = true;
    }
    if (!calls?.length) failed = true;
  }

  const ok =
    totals["strong PM"] >= 7 && totals["weak SPM"] <= 4.5 &&
    totals["ambiguous PM"] > totals["weak SPM"] && totals["ambiguous PM"] < totals["strong PM"];
  console.log(`\nordering strong > ambiguous > weak with strong>=7, weak<=4.5: ${ok ? "yes" : "NO"}`, totals);
  if (!ok || failed) process.exit(1);
  console.log("Phase 2 PASS");
}

main().catch((e) => {
  console.error("Phase 2 FAIL:", e.message);
  process.exit(1);
});
