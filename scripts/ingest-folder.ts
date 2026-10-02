/**
 * Batch-ingest applications/ as mixed intake, optionally classifying roles. Never scores, drafts or sends.
 *   npm run ingest:folder                      # import all (parse + PII split only)
 *   npm run ingest:folder -- --classify        # import all, then run the role step
 *   npm run ingest:folder -- --only a.pdf,b.pdf --classify
 */
import "./_env";
import { ingestFolder } from "../lib/ingest";
import { classifyCandidate } from "../lib/pipeline";

const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const only = arg("--only")?.split(",").map((s) => s.trim());
  const results = await ingestFolder({ only });
  for (const r of results) console.log(`${r.error ? "FAIL" : r.duplicate ? "dup " : "new "} ${r.file_name}${r.error ? ` — ${r.error}` : ""}${r.warnings?.length ? ` [${r.warnings.join(", ")}]` : ""}`);
  if (!process.argv.includes("--classify")) return;

  const ids = results.filter((r) => r.id).map((r) => ({ id: r.id!, file: r.file_name }));
  const queue = [...ids];
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (queue.length) {
      const { id, file } = queue.shift()!;
      try {
        const c = await classifyCandidate(id);
        console.log(`classified ${file}: ${c.role_guess} (${c.role_confidence}) -> ${c.role_status}`);
      } catch (e) {
        console.log(`classify FAILED ${file}: ${(e as Error).message}`);
      }
    }
  }));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
