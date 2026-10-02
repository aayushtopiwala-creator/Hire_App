/**
 * Creates the ONE Supabase Auth account that can sign in (ALLOWED_EMAIL), with a password you type.
 * The app itself has no sign-up, so this is the only way an account is made.
 *
 *   npm run auth:create-user            # create the account (prompts for the password)
 *   npm run auth:create-user -- --reset # set a new password on the existing account
 *
 * The password is read from your terminal with typing hidden, confirmed twice, and sent straight to
 * Supabase. It is never printed, logged, or written to any file. Run this yourself, in a real terminal.
 */
import "./_env";
import { allowedEmail } from "../lib/auth";
import { db } from "../lib/supabase";

const MIN_LENGTH = 12;

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) return reject(new Error("Run this in an interactive terminal, so the password can be typed with input hidden."));
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === "\r" || c === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          return resolve(value);
        }
        if (c === "\u0003") {
          stdin.setRawMode(false);
          process.stdout.write("\n");
          process.exit(130); // Ctrl-C
        }
        if (c === "\u007f" || c === "\b") value = value.slice(0, -1);
        else value += c;
      }
    };
    stdin.on("data", onData);
  });
}

async function askPassword(): Promise<string> {
  for (;;) {
    const a = await promptHidden(`Password for the Hiring Desk (at least ${MIN_LENGTH} characters, typing is hidden): `);
    if (a.length < MIN_LENGTH) {
      console.log(`Too short — use at least ${MIN_LENGTH} characters.`);
      continue;
    }
    const b = await promptHidden("Type it again: ");
    if (a !== b) {
      console.log("The two entries didn't match — try again.");
      continue;
    }
    return a;
  }
}

async function main() {
  const email = allowedEmail();
  if (!email) throw new Error("Set ALLOWED_EMAIL (Arjun's address) in .env.local first");
  const reset = process.argv.includes("--reset");

  const { data, error } = await db().auth.admin.listUsers({ perPage: 1000 });
  if (error) throw new Error(error.message);
  const existing = data.users.find((u) => u.email?.toLowerCase() === email);

  if (existing && !reset) {
    console.log(`An account for ${email} already exists. To change its password: npm run auth:create-user -- --reset`);
  } else {
    console.log(`${existing ? "Setting a new password" : "Creating the sign-in account"} for ${email}.`);
    const password = await askPassword();
    const { error: e } = existing
      ? await db().auth.admin.updateUserById(existing.id, { password })
      : await db().auth.admin.createUser({ email, password, email_confirm: true });
    if (e) throw new Error(e.message);
    console.log(existing ? "Password updated." : "Account created. Sign in at /login with this email and password.");
  }

  const others = data.users.filter((u) => u.email?.toLowerCase() !== email);
  console.log(others.length ? `Other auth accounts (they cannot get in, but consider deleting them in Supabase): ${others.map((u) => u.email).join(", ")}` : "No other auth accounts.");
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
