import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { resolveRecipient } from "../lib/email/validate";

const walk = (d: string): string[] =>
  readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : /\.(ts|tsx)$/.test(f) ? [join(d, f)] : []));
// Code only — comments that forbid bulk actions may name them.
const code = (f: string) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const ui = [...walk("app"), ...walk("components")];

test("no multi-select or bulk action exists anywhere in the UI or API", () => {
  for (const f of ui) {
    const src = code(f);
    assert.doesNotMatch(src, /type=["']checkbox["']/, `${f}: checkbox`);
    assert.doesNotMatch(src, /\b(select[ -]?all|confirm[ -]?all|send[ -]?all|bulk|batch[ -]?send|mark all)\b/i, `${f}: bulk wording`);
  }
  // The only send route is per-candidate; no route path suggests a bulk variant.
  const routes = walk("app/api").map((f) => f.replace(/\\/g, "/"));
  assert.ok(routes.includes("app/api/candidates/[id]/confirm/route.ts"));
  assert.ok(!routes.some((r) => /bulk|all|batch/i.test(r)), routes.join(","));
});

test("the confirm route acts on exactly one candidate id from the URL and accepts no id list", () => {
  const src = code("app/api/candidates/[id]/confirm/route.ts");
  assert.match(src, /const \{ id \} = await params;/);
  assert.doesNotMatch(src, /\bids\b|candidate_ids|\.in\(/);
  assert.match(src, /\.eq\("id", id\)/);
});

test("the review screen's send happens only through the per-candidate editor", () => {
  const q = code("components/ReviewQueue.tsx");
  assert.doesNotMatch(q, /\/confirm|fetch\(/, "ReviewQueue must not call any API directly");
  const e = code("components/EmailEditor.tsx");
  assert.equal(e.match(/\/confirm`/g)!.length, 1);
  // The only path to that fetch is the "Send now" button inside the one-candidate confirm box.
  assert.match(e, /onClick=\{send\}/);
  assert.equal(e.match(/onClick=\{send\}/g)!.length, 1);
});

test("EMAIL_TEST_RECIPIENT overrides the candidate's address whenever it is set", () => {
  assert.deepEqual(resolveRecipient("candidate@example.com", "arjun@example.com"), { to: "arjun@example.com" });
  assert.deepEqual(resolveRecipient("candidate@example.com", "arjun@example.com", true), { to: "arjun@example.com" }, "redirect wins even if real sends are enabled");
  assert.deepEqual(resolveRecipient(null, "arjun@example.com"), { to: "arjun@example.com" });
});

test("with no redirect configured, nothing is sent unless real sends were explicitly enabled", () => {
  for (const tr of [null, "", "   "]) assert.ok("blocked" in resolveRecipient("candidate@example.com", tr), `redirect=${JSON.stringify(tr)}`);
  assert.deepEqual(resolveRecipient("candidate@example.com", null, true), { to: "candidate@example.com" });
  assert.ok("blocked" in resolveRecipient(null, null, true));
  const route = code("app/api/candidates/[id]/confirm/route.ts");
  assert.match(route, /resolveRecipient\(c\.personal_details\.email, env\.emailTestRecipient\(\), env\.allowRealSends\(\)\)/);
  assert.match(code("lib/env.ts"), /ALLOW_REAL_SENDS\?\.trim\(\) === "true"/);
});
