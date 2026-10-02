/**
 * Phase 5 test against the running app (npm run dev, default http://localhost:3000; override with APP_URL).
 *   default:  negative checks only — nothing can be sent.
 *   --send:   additionally performs ONE real Confirm & Send for the strong-PM fixture
 *             (delivered to EMAIL_TEST_RECIPIENT), then checks Supabase and that a second send is refused.
 */
import "./_env";
import { db } from "../lib/supabase";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const post = async (path: string, body: unknown) => {
  const r = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};

async function main() {
  const { data: row } = await db().from("candidates").select("id, status, email_subject, email_body").eq("file_name", process.env.FIXTURE ?? "strong_pm_neha_kulkarni.pdf").single();
  if (!row?.email_body) throw new Error("run test:phase3 first");
  const url = `/api/candidates/${row.id}/confirm`;
  let bad = 0;
  const expect = (label: string, got: number | string, want: number | string) => {
    console.log(`${got === want ? "ok  " : "FAIL"} ${label}: ${got}`);
    if (got !== want) bad++;
  };

  if (row.status === "draft") {
    expect("confirm without confirm flag -> 400", (await post(url, { subject: row.email_subject, body: row.email_body })).status, 400);
    expect("confirm: 'true' (string) -> 400", (await post(url, { subject: row.email_subject, body: row.email_body, confirm: "true" })).status, 400);
    // Only checks that are rejected before any send logic runs. Content validation (placeholders etc.) is
    // unit-tested in tests/validate.test.ts — an HTTP negative test that fails open would send a real email.
    const draft = await post(`/api/candidates/${row.id}/draft`, { topN: 5 });
    expect("draft endpoint never sends (status stays draft)", draft.status, 200);
    const after = await db().from("candidates").select("status, sent_at").eq("id", row.id).single();
    expect("still unsent after all of the above", after.data!.status === "draft" && !after.data!.sent_at ? 1 : 0, 1);
  }

  if (process.argv.includes("--send")) {
    if (row.status === "draft") {
      // Simulated double click: two identical confirms at once. The lock must let exactly one through.
      const payload = { subject: row.email_subject, body: row.email_body, confirm: true };
      const [r1, r2] = await Promise.all([post(url, payload), post(url, payload)]);
      console.log("send responses:", r1.status, r1.json, "|", r2.status, r2.json);
      expect("exactly one of two concurrent confirms succeeds", [r1.status, r2.status].sort().join(","), "200,409");
    }
    const { data } = await db().from("candidates").select("status, sent_at, sent_to, resend_message_id, send_started_at").eq("id", row.id).single();
    console.log("supabase row:", data);
    expect("status confirmed_sent with timestamp + message id, lock released", data!.status === "confirmed_sent" && data!.sent_at && data!.resend_message_id && !data!.send_started_at ? 1 : 0, 1);
    expect("sent to EMAIL_TEST_RECIPIENT, not the candidate", data!.sent_to === process.env.EMAIL_TEST_RECIPIENT ? 1 : 0, 1);
    expect("second send refused -> 409", (await post(url, { subject: row.email_subject, body: row.email_body, confirm: true })).status, 409);
    const edit = await fetch(BASE + `/api/candidates/${row.id}/email`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ subject: "x", body: "y" }) });
    expect("editing a sent email refused -> 409", edit.status, 409);
  }

  if (bad) process.exit(1);
  console.log(process.argv.includes("--send") ? "\nPhase 5 PASS" : "\nPhase 5 negative checks PASS (run with --send for the live send)");
}

main().catch((e) => {
  console.error("Phase 5 FAIL:", e.message);
  process.exit(1);
});
