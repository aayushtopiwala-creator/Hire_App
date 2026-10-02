/**
 * Extract + score every candidate with a confirmed role and no score yet. Never drafts or sends.
 *   npm run score:confirmed               # unscored only
 *   npm run score:confirmed -- --all      # re-score everyone (e.g. after a rubric change); profiles are
 *                                         # re-extracted only where cleared (extracted_profile = null)
 *   npm run score:confirmed -- --only a.pdf,b.pdf   # re-score just these (resume an interrupted run)
 */
import "./_env";
import { processCandidate } from "../lib/pipeline";
import { db } from "../lib/supabase";

async function main() {
  let q = db().from("candidates").select("id, file_name, role").not("role", "is", null).neq("status", "confirmed_sent");
  const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1].split(",") : null;
  if (only) q = q.in("file_name", only); // resume a specific set, e.g. after an interrupted --all run
  else if (!process.argv.includes("--all")) q = q.is("total_score", null);
  const { data, error } = await q.order("file_name");
  if (error) throw new Error(error.message);
  console.log(`scoring ${data.length} confirmed candidates${process.argv.includes("--all") ? " (re-score all)" : ""}`);
  const queue = [...data];
  let done = 0;
  const failures: string[] = [];
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (queue.length) {
      const c = queue.shift()!;
      try {
        const r = await processCandidate(c.id);
        console.log(`[${++done}/${data.length}] ${c.role} ${c.file_name}: ${r.total_score}`);
      } catch (e) {
        done++;
        failures.push(`${c.file_name}: ${(e as Error).message}`);
        console.log(`[${done}/${data.length}] FAILED ${c.file_name}: ${(e as Error).message}`);
      }
    }
  }));
  console.log(`done · failures: ${failures.length}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
