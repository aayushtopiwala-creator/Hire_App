/**
 * Applies supabase/migrations/*.sql (if DATABASE_URL is set) and seeds rubric_versions
 * from rubric.txt for both roles when the stored content differs from the file.
 */
import "./_env";
import { readdirSync, readFileSync } from "node:fs";
import pg from "pg";
import { db } from "../lib/supabase";
import { ROLES } from "../lib/types";

// Migrations that existed before the ledger (all applied on the original database).
const BASELINE = [
  "0001_init.sql",
  "0002_draft_warnings.sql",
  "0003_send_lock.sql",
  "0004_audit_outlives_candidates.sql",
  "0005_role_classification.sql",
  "0006_applicant_stated_role.sql",
];

async function main() {
  if (process.env.DATABASE_URL && !/^postgres(ql)?:\/\//.test(process.env.DATABASE_URL)) {
    throw new Error(
      "DATABASE_URL must be a postgresql:// connection string (Supabase → Connect → Session pooler), not the https API URL.",
    );
  }
  if (process.env.DATABASE_URL) {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await client.connect();
    // Ledger of applied migrations, so each runs exactly once. (Re-running them all broke once 0006
    // superseded a constraint that 0005 creates.)
    const { rows: [{ exists }] } = await client.query(`select to_regclass('public.schema_migrations') is not null as exists`);
    if (!exists) {
      await client.query(`create table schema_migrations (name text primary key, applied_at timestamptz not null default now());
        alter table schema_migrations enable row level security;`);
      // Databases created before the ledger already ran these; record them rather than re-running.
      const { rows: [{ legacy }] } = await client.query(`select to_regclass('public.candidates') is not null as legacy`);
      if (legacy) {
        for (const f of BASELINE) await client.query(`insert into schema_migrations (name) values ($1)`, [f]);
        console.log(`ledger created; recorded ${BASELINE.length} pre-ledger migrations as applied`);
      }
    }
    const { rows } = await client.query(`select name from schema_migrations`);
    const done = new Set(rows.map((r) => r.name));
    for (const f of readdirSync("supabase/migrations").sort()) {
      if (done.has(f)) continue;
      // A file is one implicit transaction: it applies fully or not at all.
      await client.query(readFileSync(`supabase/migrations/${f}`, "utf8"));
      await client.query(`insert into schema_migrations (name) values ($1)`, [f]);
      console.log("applied", f);
    }
    await client.end();
  } else {
    console.log("DATABASE_URL not set — assuming you ran supabase/migrations/*.sql in the SQL editor.");
  }

  const content = readFileSync("rubric.txt", "utf8");
  for (const role of ROLES) {
    const { data, error } = await db()
      .from("rubric_versions").select("id, content").eq("role", role)
      .order("created_at", { ascending: false }).limit(1);
    if (error) throw new Error(`rubric_versions: ${error.message} (has the schema been applied?)`);
    if (data[0]?.content === content) {
      console.log(`rubric for ${role} up to date (${data[0].id})`);
      continue;
    }
    const ins = await db().from("rubric_versions").insert({ role, content }).select("id").single();
    if (ins.error) throw new Error(ins.error.message);
    console.log(`seeded rubric for ${role} -> ${ins.data.id}`);
  }
}

main().catch((e) => {
  console.error(e.message || e.code || e, e.errors?.map((x: Error) => x.message) ?? "");
  process.exit(1);
});
