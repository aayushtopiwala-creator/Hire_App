import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(p) ? [p] : [];
  });
}
const files = ["app", "lib", "components", "scripts"].flatMap(walk);
const appFiles = files.filter((f) => !f.startsWith("scripts/"));

test("only lib/email/send.ts imports resend", () => {
  const importers = files.filter((f) => /from\s+["']resend["']|require\(["']resend["']\)/.test(readFileSync(f, "utf8")));
  assert.deepEqual(importers, ["lib/email/send.ts"]);
});

test("only the confirm route calls sendConfirmedEmail", () => {
  const callers = files.filter((f) => f !== "lib/email/send.ts" && readFileSync(f, "utf8").includes("sendConfirmedEmail"));
  assert.deepEqual(callers, ["app/api/candidates/[id]/confirm/route.ts"]);
});

test("the confirm route requires an explicit confirm flag and claims a draft row", () => {
  const src = readFileSync("app/api/candidates/[id]/confirm/route.ts", "utf8");
  assert.match(src, /confirm !== true/);
  assert.match(src, /\.eq\("status", "draft"\)/);
});

test("the confirm route marks confirmed_sent only after Resend returns", () => {
  const src = readFileSync("app/api/candidates/[id]/confirm/route.ts", "utf8");
  const sendAt = src.indexOf("await sendConfirmedEmail(");
  const markAt = src.indexOf('status: "confirmed_sent"');
  assert.ok(sendAt > 0 && markAt > sendAt, "status must be set after the Resend call");
  assert.equal(src.match(/confirmed_sent"/g)!.filter(Boolean).length >= 1, true);
});

test("the client only calls /confirm from the explicit Send now handler", () => {
  // scripts/test-phase5.ts is the manual live test harness and is excluded here.
  const hits = appFiles.filter((f) => readFileSync(f, "utf8").includes("/confirm`"));
  assert.deepEqual(hits, ["components/EmailEditor.tsx"]);
  assert.equal(readFileSync("components/EmailEditor.tsx", "utf8").match(/\/confirm`/g)!.length, 1);
});

test("the only other Resend-looking env use is in env.ts / send.ts", () => {
  const users = files.filter((f) => readFileSync(f, "utf8").includes("resendApiKey"));
  assert.deepEqual(users.sort(), ["lib/email/send.ts", "lib/env.ts"]);
});
