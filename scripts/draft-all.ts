/**
 * Draft every candidate: per pool, the shortlist size is the natural score break (lib/shortlist.ts);
 * top N get an invite + brief, everyone else a personalised rejection. Writes DRAFTS ONLY — there is
 * no send path here (sending is only the founder's per-candidate Confirm & Send).
 *   npm run draft:all              # skip drafts that already match their type
 *   npm run draft:all -- --force   # regenerate (never touches founder-edited or sent emails)
 */
import "./_env";
import { draftCandidate, rankRole } from "../lib/pipeline";
import { suggestTopN } from "../lib/shortlist";
import { db } from "../lib/supabase";
import type { Role } from "../lib/types";

async function main() {
  const force = process.argv.includes("--force");
  for (const role of ["PM", "SPM"] as Role[]) {
    const { ranked, unscored } = await rankRole(role);
    if (unscored) throw new Error(`${unscored} ${role} candidates unscored — score first`);
    const s = suggestTopN(ranked.map((r) => r.total));
    console.log(`${role}: ${ranked.length} candidates · shortlist ${s.n} (natural break #${s.n} ${s.above} → #${s.n + 1} ${s.below}, gap ${s.gap})`);
    const { data: rows } = await db().from("candidates").select("id, file_name, email_edited").in("id", ranked.map((r) => r.id));
    const queue = ranked.map((r) => ({ ...r, file: rows!.find((x) => x.id === r.id)!.file_name, edited: rows!.find((x) => x.id === r.id)!.email_edited }));
    await Promise.all(Array.from({ length: 3 }, async () => {
      while (queue.length) {
        const r = queue.shift()!;
        try {
          // Force regenerates, but a founder's edits are never overwritten in bulk.
          const out = await draftCandidate(r.id, s.n, { force: force && !r.edited });
          const { data: c } = await db().from("candidates").select("email_type, draft_warnings").eq("id", r.id).single();
          console.log(`  #${String(r.rank).padStart(2)} ${String(r.total).padStart(5)} ${r.file.padEnd(26)} ${out.padEnd(14)} ${c!.email_type}${c!.draft_warnings.length ? `  WARN ${JSON.stringify(c!.draft_warnings)}` : ""}`);
        } catch (e) {
          console.log(`  #${r.rank} ${r.file} FAILED: ${(e as Error).message}`);
        }
      }
    }));
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
