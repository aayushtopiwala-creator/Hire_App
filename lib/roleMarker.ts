import type { Role } from "./types";

/**
 * The role the applicant selected, when the file name carries it (in a real intake form this is a
 * field, not an inference). Markers are short role codes as a separate token, any case:
 *   SPM: "spm", "senior_pm" / "senior-pm" / "seniorpm", "sr_pm" / "sr.pm" / "srpm"
 *   PM:  "pm"
 * Words like "product_manager" are NOT markers — in a file name they're as likely the applicant's
 * current title as the role applied for. A name with both an SPM and a PM marker is ambiguous -> null.
 */
export function roleFromFileName(fileName: string): Role | null {
  const stem = fileName.replace(/\.[a-z0-9]+$/i, "").toLowerCase();
  const tok = (re: string) => new RegExp(`(?:^|[^a-z])(?:${re})(?:[^a-z]|$)`).test(stem);
  const spm = tok("spm|senior[\\s._-]*pm|sr[\\s._-]*pm");
  // Plain "pm" not part of an SPM marker: remove SPM markers first, then look again.
  const withoutSpm = stem.replace(/(?:spm|senior[\s._-]*pm|sr[\s._-]*pm)/g, " ");
  const pm = /(?:^|[^a-z])pm(?:[^a-z]|$)/.test(withoutSpm);
  if (spm && pm) return null;
  return spm ? "SPM" : pm ? "PM" : null;
}
