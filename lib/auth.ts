import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { env } from "./env";

/**
 * Single-user access: exactly one email (ALLOWED_EMAIL — Arjun's) may sign in.
 * Enforced in layers, any one of which is enough to keep others out:
 *   1. The only account is created out-of-band (npm run auth:create-user); the app has no sign-up, and
 *      the sign-in form never sends any address but ALLOWED_EMAIL to Supabase.
 *   2. proxy.ts redirects/401s every request without a session for ALLOWED_EMAIL.
 *   3. Every page (requireArjun) and every API route (guardApi) re-checks on the server — the Next.js
 *      docs warn against relying on Proxy alone.
 * If ALLOWED_EMAIL is unset, nobody is allowed (fail closed).
 */
export function allowedEmail(): string | null {
  const e = process.env.ALLOWED_EMAIL?.trim().toLowerCase();
  return e ? e : null;
}

export function isAllowed(email: string | null | undefined): boolean {
  const allowed = allowedEmail();
  return !!allowed && !!email && email.trim().toLowerCase() === allowed;
}

/** Per-request Supabase client using the ANON key, only for auth. Data access stays on the service key, server-side. */
export async function authClient() {
  const store = await cookies();
  return createServerClient(env.supabaseUrl(), env.supabaseAnonKey(), {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only; proxy.ts refreshes them instead.
        }
      },
    },
  });
}

/** The signed-in user's email if (and only if) it is the allowed one. Validates with Supabase, not just the cookie. */
export async function currentArjun(): Promise<string | null> {
  try {
    const { data } = await (await authClient()).auth.getUser();
    return isAllowed(data.user?.email) ? data.user!.email! : null;
  } catch {
    return null;
  }
}

/** For pages: redirect to the sign-in page unless the allowed user is signed in. */
export async function requireArjun(): Promise<string> {
  const email = await currentArjun();
  if (!email) redirect("/login");
  return email;
}

/** For API routes: a 401 response to return, or null when the allowed user is signed in. */
export async function guardApi(): Promise<NextResponse | null> {
  return (await currentArjun()) ? null : NextResponse.json({ error: "sign in required" }, { status: 401 });
}
