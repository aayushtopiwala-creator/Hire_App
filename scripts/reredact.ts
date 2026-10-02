/**
 * Re-run the PII split on stored CVs after a redaction-rule change. Only rows whose redacted text
 * actually changes are updated; their extracted profile is cleared so the next scoring re-extracts
 * from the corrected text. Roles, sends and founder-entered names are left untouched. No AI.
 */
import "./_env";
import { findPii, splitPii } from "../lib/pii";
import { db } from "../lib/supabase";

async function main() {
  const { data, error } = await db().from("candidates").select("id, file_name, cv_raw_text, cv_redacted_text, personal_details, status");
  if (error) throw new Error(error.message);
  for (const r of data) {
    const founderName = r.personal_details.name_confidence === "founder" ? r.personal_details.name : undefined;
    const { personal, redacted } = splitPii(r.cv_raw_text, { fileName: r.file_name, name: founderName });
    if (redacted === r.cv_redacted_text) continue;
    if (r.status === "confirmed_sent") { console.log(`skip (sent) ${r.file_name}`); continue; }
    if (!findPii(redacted, personal).ok) throw new Error(`${r.file_name}: new redaction fails the PII guard — aborting`);
    const { error: e } = await db().from("candidates")
      .update({ personal_details: personal, cv_redacted_text: redacted, extracted_profile: null })
      .eq("id", r.id);
    if (e) throw new Error(e.message);
    console.log(`re-redacted ${r.file_name}  (third-party names: ${JSON.stringify(r.personal_details.third_party_names)} -> ${JSON.stringify(personal.third_party_names)})`);
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
