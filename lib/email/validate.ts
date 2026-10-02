import { personalize } from "../ai/draft";
import type { PersonalDetails } from "../types";

/**
 * Pure pre-send validation for Confirm & Send (no I/O, so it's unit-testable without any risk of sending).
 * Placeholders other than [FIRST_NAME] are checked on the founder's raw text BEFORE filling —
 * filling first would turn "Hi [CANDIDATE]" into a real name and hide the problem.
 */
export function prepareEmail(subject: unknown, body: unknown, personal: PersonalDetails): { subject: string; text: string } | { error: string } {
  if (typeof subject !== "string" || typeof body !== "string" || !subject.trim() || !body.trim()) {
    return { error: "subject and body are required" };
  }
  if (/\[(CANDIDATE|REFERENCE|CONTACT|LINK)\]/.test(subject + body)) {
    return { error: "email still contains a redaction placeholder — edit it before sending" };
  }
  const s = personalize(subject, personal).trim();
  const t = personalize(body, personal).trim();
  if (/\[[A-Z_]+\]/.test(s + t)) return { error: "email still contains a placeholder — edit it before sending" };
  return { subject: s, text: t };
}

/**
 * Who a confirmed email actually goes to. While EMAIL_TEST_RECIPIENT is set, EVERY send goes there,
 * whatever the candidate's address or what the dashboard shows; it stays set until Arjun says otherwise.
 * With it unset, nothing is sent unless real sends were explicitly enabled.
 */
export function resolveRecipient(
  candidateEmail: string | null,
  testRecipient: string | null,
  allowRealSends = false,
): { to: string } | { blocked: string } {
  const redirect = testRecipient?.trim();
  if (redirect) return { to: redirect };
  // Fail closed: a missing EMAIL_TEST_RECIPIENT (e.g. forgotten on a new deployment) must NOT silently
  // start emailing candidates. Real sends need ALLOW_REAL_SENDS=true, set deliberately when Arjun says so.
  if (!allowRealSends) return { blocked: "Sending is disabled: EMAIL_TEST_RECIPIENT is not set and real sends have not been enabled (ALLOW_REAL_SENDS)." };
  return candidateEmail ? { to: candidateEmail } : { blocked: "no email address found in this CV" };
}
