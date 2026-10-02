/**
 * Phase 1 test: ingest one CV into Supabase and verify, from the stored row, that
 * personal_details and cv_redacted_text are separated. No AI calls exist in this path.
 */
import "./_env";
import { readFileSync } from "node:fs";
import { ingestFile } from "../lib/ingest";
import { findPii } from "../lib/pii";
import { db } from "../lib/supabase";

async function main() {
  const file = process.argv[2] ?? "fixtures/strong_pm_neha_kulkarni.pdf";
  const res = await ingestFile("PM", file.split("/").pop()!, readFileSync(file));
  if (res.error) throw new Error(res.error);

  const { data: row, error } = await db().from("candidates").select("*").eq("id", res.id).single();
  if (error) throw new Error(error.message);

  const check = findPii(row.cv_redacted_text, row.personal_details);
  console.log("id:", row.id);
  console.log("personal_details:", JSON.stringify(row.personal_details, null, 2));
  console.log("redacted (first 12 lines):\n" + row.cv_redacted_text.split("\n").slice(0, 12).join("\n"));
  console.log("PII check on stored redacted text:", check.ok ? "CLEAN" : JSON.stringify(check.leaks));
  if (!check.ok || !row.personal_details.name || !row.personal_details.email) process.exit(1);
  console.log("\nPhase 1 PASS");
}

main().catch((e) => {
  console.error("Phase 1 FAIL:", e.message);
  process.exit(1);
});
