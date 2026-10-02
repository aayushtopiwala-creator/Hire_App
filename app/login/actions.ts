"use server";

import { redirect } from "next/navigation";
import { authClient, isAllowed } from "@/lib/auth";

/**
 * Email + password sign-in for the single allowed account. There is no sign-up anywhere in the app;
 * the one account is created with `npm run auth:create-user`. Any address other than ALLOWED_EMAIL
 * gets the same "incorrect" message as a wrong password, without ever reaching Supabase.
 */
export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!isAllowed(email) || !password) redirect("/login?error=invalid");

  const { error } = await (await authClient()).auth.signInWithPassword({ email, password });
  if (error) {
    // Supabase rate-limits repeated attempts per IP; surface that distinctly, everything else stays generic.
    redirect(`/login?error=${/rate|too many|seconds/i.test(error.message) ? "rate" : "invalid"}`);
  }
  redirect("/");
}
