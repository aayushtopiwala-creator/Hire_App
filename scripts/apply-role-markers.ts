/**
 * Re-apply the file-name role rule to rows already imported. Rows with a marker become
 * applicant_stated with that role. Never touches founder-confirmed or already-sent rows, or rows
 * without a marker. The classifier's earlier guess is kept on the row as history.
 */
import "./_env";
import { roleFromFileName } from "../lib/roleMarker";
import { db } from "../lib/supabase";

async function main() {
  const { data, error } = await db().from("candidates").select("id, file_name, role, role_status, role_guess, role_confidence, status, total_score").order("file_name");
  if (error) throw new Error(error.message);
  for (const c of data) {
    const marker = roleFromFileName(c.file_name);
    const before = `${c.role ?? "—"} (${c.role_status}${c.role_guess ? `, classifier said ${c.role_guess}/${c.role_confidence}` : ""})`;
    if (!marker) { console.log(`unchanged  ${c.file_name.padEnd(26)} no marker · ${before}`); continue; }
    if (c.role_status === "founder_confirmed" || c.status === "confirmed_sent") { console.log(`SKIPPED    ${c.file_name.padEnd(26)} ${c.role_status}/${c.status} — your decision stands · ${before}`); continue; }
    if (c.role_status === "applicant_stated" && c.role === marker) { console.log(`already    ${c.file_name.padEnd(26)} ${marker}`); continue; }
    if (c.total_score !== null && c.role !== marker) throw new Error(`${c.file_name} is scored under ${c.role}; refusing to change role without a reset`);
    const { error: e } = await db().from("candidates")
      .update({ role: marker, role_status: "applicant_stated", role_confirmed_at: new Date().toISOString() })
      .eq("id", c.id);
    if (e) throw new Error(e.message);
    console.log(`SET        ${c.file_name.padEnd(26)} ${before}  ->  ${marker} (applicant_stated)`);
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
