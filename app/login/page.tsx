import { redirect } from "next/navigation";
import { currentArjun } from "@/lib/auth";
import { signIn } from "./actions";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  invalid: "Email or password is incorrect.",
  rate: "Too many attempts. Wait a few minutes and try again.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await currentArjun()) redirect("/");
  const { error } = await searchParams;
  return (
    <div className="login">
      <h1>Sign in</h1>
      <p className="lede">Kargo’s hiring desk is private.</p>
      {error && <p className="error-text">{ERRORS[error] ?? ERRORS.invalid}</p>}
      <form action={signIn} className="login-form">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required autoComplete="username" autoFocus />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" required autoComplete="current-password" />
        <button className="btn btn-primary" type="submit">Sign in</button>
      </form>
    </div>
  );
}
