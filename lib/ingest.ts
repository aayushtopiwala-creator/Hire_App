import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { extractText, SUPPORTED_EXTENSIONS } from "./parse";
import { splitPii } from "./pii";
import { roleFromFileName } from "./roleMarker";
import { db } from "./supabase";
import type { Role } from "./types";

export interface IngestResult {
  file_name: string;
  id?: string;
  warnings?: string[];
  error?: string;
  duplicate?: boolean;
}

/**
 * File -> raw text -> PII split -> candidates row. No AI.
 * Role, in order of authority:
 *   1. `role` given = the founder picked it at upload            -> founder_confirmed
 *   2. a role marker in the file name = the applicant's own choice -> applicant_stated (no classifier, no review)
 *   3. neither = mixed intake; the classify step guesses it later  -> unclassified
 */
export async function ingestFile(role: Role | null, fileName: string, buf: Buffer): Promise<IngestResult> {
  try {
    const hash = createHash("sha256").update(buf).digest("hex");
    const { data: existing } = await db().from("candidates").select("id").eq("file_hash", hash).maybeSingle();
    if (existing) return { file_name: fileName, id: existing.id, duplicate: true };

    const raw = await extractText(buf, fileName);
    const { personal, redacted } = splitPii(raw, { fileName });
    const stated = role ? null : roleFromFileName(fileName);
    const finalRole = role ?? stated;
    const { data, error } = await db()
      .from("candidates")
      .insert({
        role: finalRole,
        role_status: role ? "founder_confirmed" : stated ? "applicant_stated" : "unclassified",
        role_confirmed_at: finalRole ? new Date().toISOString() : null,
        file_name: fileName,
        file_hash: hash,
        personal_details: personal,
        cv_raw_text: raw,
        cv_redacted_text: redacted,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { file_name: fileName, id: data.id, warnings: personal.warnings };
  } catch (e) {
    return { file_name: fileName, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The fixed intake folder. Not configurable from the request, so nothing outside it can be read. */
export const APPLICATIONS_DIR = join(process.cwd(), "applications");

export function listApplicationFiles(): string[] {
  return readdirSync(APPLICATIONS_DIR)
    .filter((f) => SUPPORTED_EXTENSIONS.some((ext) => f.toLowerCase().endsWith(ext)))
    .sort();
}

/** Batch-ingest applications/ with no role (mixed intake). Files already ingested (same bytes) are skipped. */
export async function ingestFolder(opts: { only?: string[]; limit?: number } = {}): Promise<IngestResult[]> {
  let files = listApplicationFiles();
  if (opts.only?.length) files = files.filter((f) => opts.only!.includes(f));
  if (opts.limit) files = files.slice(0, opts.limit);
  const out: IngestResult[] = [];
  for (const f of files) out.push(await ingestFile(null, f, readFileSync(join(APPLICATIONS_DIR, f))));
  return out;
}
