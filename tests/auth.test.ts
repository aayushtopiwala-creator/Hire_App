import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const walk = (d: string): string[] =>
  readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f).replace(/\\/g, "/")]));

test("every API handler checks the session before doing anything", () => {
  const routes = walk("app/api").filter((f) => f.endsWith("route.ts"));
  assert.ok(routes.length >= 9);
  for (const f of routes) {
    const src = readFileSync(f, "utf8");
    const handlers = [...src.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\(/g)].length;
    const guarded = [...src.matchAll(/export async function (?:GET|POST|PATCH|PUT|DELETE)\([\s\S]*?\) \{\n  const denied = await guardApi\(\);\n  if \(denied\) return denied;/g)].length;
    assert.ok(handlers > 0, f);
    assert.equal(guarded, handlers, `${f}: every handler must start with guardApi()`);
  }
});

test("every page except /login requires the signed-in allowed user", () => {
  for (const f of walk("app").filter((f) => f.endsWith("page.tsx"))) {
    const src = readFileSync(f, "utf8");
    if (f === "app/login/page.tsx") continue;
    assert.match(src, /await requireArjun\(\);/, f);
  }
});

test("proxy: only the sign-in page is public", () => {
  const src = readFileSync("proxy.ts", "utf8");
  assert.match(src, /const PUBLIC = \[\/\^\\\/login\$\/\];/);
  assert.match(src, /status: 401/);
  assert.match(src, /NextResponse\.redirect\(url\)/);
});

test("allowlist: exactly one address, case-insensitive, fails closed", async () => {
  const { isAllowed } = await import("../lib/auth");
  const prev = process.env.ALLOWED_EMAIL;
  process.env.ALLOWED_EMAIL = " Arjun@Kargo.example ";
  assert.equal(isAllowed("arjun@kargo.example"), true);
  assert.equal(isAllowed("ARJUN@KARGO.EXAMPLE"), true);
  assert.equal(isAllowed("someone@kargo.example"), false);
  assert.equal(isAllowed("arjun@kargo.example.evil.com"), false);
  assert.equal(isAllowed(null), false);
  delete process.env.ALLOWED_EMAIL;
  assert.equal(isAllowed("arjun@kargo.example"), false, "no ALLOWED_EMAIL means nobody");
  if (prev !== undefined) process.env.ALLOWED_EMAIL = prev;
});

test("no sign-up exists: the action only signs in, and only for the allowed address", () => {
  const src = readFileSync("app/login/actions.ts", "utf8");
  assert.match(src, /if \(!isAllowed\(email\) \|\| !password\) redirect\("\/login\?error=invalid"\);[\s\S]*signInWithPassword/);
  for (const f of walk("app").concat(walk("lib"), walk("components"), ["proxy.ts"])) {
    const code = readFileSync(f, "utf8");
    assert.doesNotMatch(code, /auth\.signUp\(|signInWithOtp|admin\.createUser/, f);
  }
  // The only place an account is created is the operator script, which never prints the password.
  const script = readFileSync("scripts/create-auth-user.ts", "utf8");
  assert.match(script, /admin\.createUser\(\{ email, password, email_confirm: true \}\)/);
  // Strip string/template literals, then make sure no log call receives the password variable.
  const logs = [...script.matchAll(/console\.\w+\(([^;]*)\);/g)].map((m) => m[1].replace(/`[^`]*`|"[^"]*"|'[^']*'/g, '""'));
  assert.ok(logs.length > 0);
  for (const l of logs) assert.doesNotMatch(l, /\bpassword\b|\b[ab]\b/, `a log call references the password: ${l}`);
  assert.match(script, /setRawMode\(true\)/);
});
