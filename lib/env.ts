function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name} — see .env.example`);
  return v;
}

export const env = {
  supabaseUrl: () => required("SUPABASE_URL"),
  supabaseServiceKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  /** Publishable/anon key — used only for Supabase Auth (password sign-in); RLS keeps it away from all data. */
  supabaseAnonKey: () => required("SUPABASE_ANON_KEY"),
  geminiApiKey: () => required("GEMINI_API_KEY"),
  geminiModel: () => process.env.GEMINI_MODEL || "gemini-3.8-flash",
  resendApiKey: () => required("RESEND_API_KEY"),
  emailFrom: () => process.env.EMAIL_FROM || "Arjun Mehta <onboarding@resend.dev>",
  emailTestRecipient: () => process.env.EMAIL_TEST_RECIPIENT?.trim() || null,
  /** Only "true" lets an email reach a real candidate (and only when EMAIL_TEST_RECIPIENT is unset). */
  allowRealSends: () => process.env.ALLOW_REAL_SENDS?.trim() === "true",
  topNDefault: () => Number(process.env.TOP_N_DEFAULT) || 5,
  /** Filled into drafts locally; never sent to Gemini. */
  senderSignature: () => (process.env.SENDER_SIGNATURE || "Arjun Mehta\nFounder, Kargo").replace(/\\n/g, "\n"),
};
