import { readFileSync } from "node:fs";
import { ingestFile } from "../lib/ingest";
import { db } from "../lib/supabase";
import type { Role } from "../lib/types";

export const FIXTURES: { file: string; role: Role; label: string }[] = [
  { file: "fixtures/strong_pm_neha_kulkarni.pdf", role: "PM", label: "strong PM" },
  { file: "fixtures/weak_spm_karan_malhotra.docx", role: "SPM", label: "weak SPM" },
  { file: "fixtures/ambiguous_pm_farah_sayed.txt", role: "PM", label: "ambiguous PM" },
];

/** Deletes previous synthetic-fixture rows (never real applications) and re-ingests them. */
export async function freshFixtures(): Promise<{ id: string; label: string }[]> {
  const names = FIXTURES.map((f) => f.file.split("/").pop()!);
  await db().from("candidates").delete().in("file_name", names).like("personal_details->>email", "%.test@example.com");
  const out = [];
  for (const f of FIXTURES) {
    const r = await ingestFile(f.role, f.file.split("/").pop()!, readFileSync(f.file));
    if (r.error) throw new Error(r.error);
    out.push({ id: r.id!, label: f.label });
  }
  return out;
}
