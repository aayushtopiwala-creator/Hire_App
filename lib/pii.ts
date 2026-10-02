import type { PersonalDetails } from "./types";

/**
 * Pattern-based PII split. Runs BEFORE any AI call exists in the pipeline:
 *   raw CV text -> { personal_details, redacted text }
 * Placeholders: [CANDIDATE] for the candidate's name, [CONTACT] for email/phone/profile links,
 * [LINK] for other URLs, [REFERENCE] for third-party names (referees, quoted managers).
 */

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi;
// Loose phone shape; a match only counts as a phone if it has 10–13 digits, or is a phone glued to
// its own duplicate as designed-PDF headers extract ("+91 98202 1134598202 11345") — see isPhone.
// Digit boundaries only: designed PDFs glue the number straight onto the next word ("64037ravi-kumar-pm").
const PHONE_RE = /(?<!\d)\+?\(?\d[\d\s().-]{8,60}\d(?!\d)/g;
// Also catches malformed "https:/" (seen in real CVs) and bare "domain.tld/path" links.
const URL_RE =
  /\b(?:https?:\/\/?|www\.)[^\s<>()]+|\b(?:linkedin\.com|github\.com|medium\.com|substack\.com)\/[^\s<>()]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|in|io|co|me|site|app|dev|net|org|ai|ly|page|bio)\/[^\s<>()]*/gi;
const PROFILE_URL_RE = /linkedin\.com|github\.com/i;

// Words that disqualify a line from being the candidate's name.
const NOT_A_NAME = new Set(
  (
    "curriculum vitae resume résumé cv profile summary objective contact experience education skills " +
    "product manager senior lead head engineer analyst director consultant professional mumbai bangalore " +
    "bengaluru delhi pune chennai hyderabad india email phone mobile linkedin address page " +
    "core competencies competency academic qualifications qualification certifications achievements projects " +
    "work history employment career languages interests strategy operations leader venture builder marketing " +
    "university college institute technological technology school academy imt iim iit nit bits " +
    // seen as false positives on real CVs: date words, title words, adjectives
    "present current now till date associate assistant junior principal staff chief officer executive vice president " +
    "founder cofounder co-founder former ex reports reporting failed driven based led focused first business program " +
    "programme project delivery growth revenue profitability general partner member intern trainee fellow"
  ).split(" "),
);

const NAME_WORD = /^[\p{Lu}][\p{L}'’.-]*$/u;

const TITLE_WORDS =
  "Lead|Manager|Head|Director|VP|Vice President|CTO|CEO|COO|CPO|Founder|Co-founder|Engineer|Partner|Principal|Supervisor|Customer|Client|Colleague";

const CAP = "[\\p{Lu}][\\p{L}'’-]+";
// Name words are joined by a single space — a name never spans a line break ("Years\nOla" is not a name).
const NAME_2_3 = `${CAP}(?: ${CAP}){1,2}`;

// Match a verb whatever the case of its first letter ("Worked with" / "worked with").
const anyCase = (words: string[]) => words.map((w) => `[${w[0].toUpperCase()}${w[0]}]${w.slice(1)}`).join("|");

// "Dr. Sharma", "Ms Priya Nair" — an honorific marks a person even with a single name.
const HONORIFIC_NAME_RE = new RegExp(`\\b((?:Mr|Mrs|Ms|Miss|Dr|Prof)\\.? +)(${CAP}(?: ${CAP}){0,2})`, "gu");

// "<person-context phrase> Name Surname": the phrase is kept, the name becomes [REFERENCE].
const PERSON_CONTEXT_RE = new RegExp(
  `(\\b(?:(?:${anyCase(["worked", "working", "work", "partnered", "partnering", "collaborated", "collaborating", "teamed up", "paired", "co-led", "co-founded"])})\\s+(?:closely\\s+|directly\\s+)?(?:with|alongside|under)|` +
    `(?:${anyCase(["reported", "reporting", "reports", "report"])})\\s+(?:directly\\s+)?to|` +
    `(?:${anyCase(["mentored", "managed", "coached", "hired", "recruited", "supervised", "trained", "referred", "recommended", "endorsed", "praised"])})\\s+by|` +
    `(?:${anyCase(["mentoring", "coaching", "onboarded", "onboarding"])})|under\\s+the\\s+guidance\\s+of|thanks\\s+to)\\s+)` +
    `(${NAME_2_3})(?=[\\s,.;:)'’]|$)`,
  "gu",
);
// "Name Surname (VP Sales)" / "Name Surname, our CTO". The comma form needs "our/my/the…": CV headers are
// routinely "Company, City Title" ("Ashok Leyland, Chennai Deputy Manager"), which is not a person.
const NAME_BEFORE_TITLE_RE = new RegExp(
  `(?<![\\p{L}\\]])(${NAME_2_3})((?:\\s*\\(|,\\s*(?:our|my|the|then|a|an)\\s+)(?:[\\p{L}& ]{0,30}\\b)?(?:${"Lead|Manager|Head|Director|VP|Vice President|CTO|CEO|COO|CPO|CFO|Founder|Co-founder|Partner|Principal|Supervisor"})\\b)`,
  "gu",
);

// Tokens that mark an organisation, product, place or team rather than a person.
const ORG_WORDS = new Set(
  (
    "ltd pvt inc llc llp limited corp corporation company co group holdings technologies technology tech solutions systems " +
    "software labs logistics shipping forwarding freight cargo express line lines maritime marine port ports terminal terminals " +
    "customs agency agencies services consulting consultancy partners ventures capital bank finance airlines airways rail railways " +
    "university college institute school academy foundation trust council ministry department government board authority " +
    "india mumbai pune delhi bengaluru bangalore chennai hyderabad gurugram noida kolkata ahmedabad nhava sheva jnpt jnpa " +
    "sales marketing engineering product design operations ops finance legal hr support success data platform team teams " +
    "google amazon microsoft maersk dhl fedex ups blue dart allcargo mahindra tata reliance flipkart meesho zomato swiggy " +
    "sap oracle salesforce jira excel whatsapp aws azure gcp api erp tms wms crm " +
    "laboratories laboratory realty estates properties pharma pharmaceuticals healthcare hospital hospitals motors " +
    "automotive industries enterprises retail foods beverages textiles steel energy power infra infrastructure " +
    "media studios networks telecom insurance finserv fintech securities exchange ola uber"
  ).split(" "),
);

function isLikelyPersonName(s: string): boolean {
  const toks = s.trim().split(/\s+/);
  if (toks.length < 2 || toks.length > 3) return false;
  if (toks.some((t) => t === "[CANDIDATE]" || t.startsWith("["))) return false;
  if (toks.some((t) => ORG_WORDS.has(t.toLowerCase().replace(/[’']s$/, "")))) return false;
  if (toks.some((t) => t.length > 1 && t === t.toUpperCase())) return false; // acronyms: "JNPT Terminal", "CHA Team"
  return toks.every((t) => NAME_WORD.test(t) && !NOT_A_NAME.has(t.toLowerCase()));
}

function isPhone(s: string): boolean {
  const digits = s.replace(/\D/g, "");
  if (digits.length > 13) return isGluedDuplicatePhone(digits);
  if (digits.length < 10) return false;
  // Year ranges like "2016 – 2019 2020 2021" can reach 10+ digits; real phones rarely contain 4-digit groups starting 19/20 back-to-back.
  if (/^(?:(?:19|20)\d{2}[\s–-]*){3,}$/.test(s.trim())) return false;
  return true;
}

/**
 * One number printed several times with no separator, as designed-PDF headers extract:
 * "919820211345" + "9820211345" (+ "9820211345"). Accept if the run is just repeats of its last
 * 10 digits, each optionally prefixed by the 91 country code.
 */
function isGluedDuplicatePhone(digits: string): boolean {
  const base = digits.slice(-10);
  return new RegExp(`^(?:(?:91)?${base}){2,}$`).test(digits);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toTitleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, p, c) => p + c.toUpperCase());
}

function looksLikeName(line: string): boolean {
  const words = line.trim().split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  if (/\d|@|\||:|,/.test(line)) return false;
  return words.every((w) => {
    const bare = w.toLowerCase().replace(/[.,]/g, "");
    return NAME_WORD.test(w) && !NOT_A_NAME.has(bare) && !ORG_WORDS.has(bare);
  });
}

export type NameConfidence = "high" | "low" | "founder";
export interface NameDetection {
  name: string | null;
  method: "label" | "contact_line" | "repeated" | "header" | "founder" | "none";
  confidence: NameConfidence | null;
}

/** Undo PDF glue: "ASHA RAOAsha Rao" -> "ASHA RAO Asha Rao", "fundraising.ASHA" -> "fundraising. ASHA". */
function unglue(s: string): string {
  return s
    .replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2")
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2")
    .replace(/([.!?;:])(?=\p{Lu})/gu, "$1 ");
}

/**
 * The trailing run of name-like words in a text segment, with a doubled name collapsed
 * ("ASHA RAO Asha Rao" -> "Asha Rao"). Returns null unless 2–4 words remain.
 */
function nameFromSegment(segment: string): string | null {
  const afterSentence = unglue(segment).split(/[.!?]\s+/).at(-1) ?? "";
  const toks = afterSentence.trim().split(/\s+/).filter(Boolean);
  const run: string[] = [];
  for (let i = toks.length - 1; i >= 0 && run.length < 8; i--) {
    const t = toks[i];
    const bare = t.toLowerCase();
    if (!NAME_WORD.test(t) || NOT_A_NAME.has(bare) || ORG_WORDS.has(bare)) break;
    run.unshift(t);
  }
  let words = run;
  const half = words.length / 2;
  if (words.length >= 4 && Number.isInteger(half) && words.slice(0, half).join(" ").toLowerCase() === words.slice(half).join(" ").toLowerCase()) {
    words = words.slice(half);
  }
  const candidate = words.join(" ");
  return looksLikeName(candidate) ? normalizeName(candidate) : null;
}

const SEGMENT_SPLIT = /\s[|•·–—]\s|\s{2,}|\t/;

export function detectName(text: string): NameDetection {
  const labeled = text.match(/^\s*(?:full\s+)?name\s*[:–-]\s*([^\n]{3,60})$/im);
  if (labeled && looksLikeName(labeled[1])) return { name: normalizeName(labeled[1]), method: "label", confidence: "high" };

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  // Contact line: the name almost always sits just before the first email — on the same line, or
  // within the few lines above it (designed PDFs often extract this header block last).
  const emailIdx = lines.findIndex((l) => new RegExp(EMAIL_RE.source, "i").test(l));
  if (emailIdx >= 0) {
    const before = lines[emailIdx].slice(0, lines[emailIdx].search(new RegExp(EMAIL_RE.source, "i")));
    const sameLine = nameFromSegment(before.split(SEGMENT_SPLIT).at(-1) ?? "");
    if (sameLine) return { name: sameLine, method: "contact_line", confidence: "high" };
    for (let i = emailIdx - 1; i >= Math.max(0, emailIdx - 3); i--) {
      for (const seg of lines[i].split(SEGMENT_SPLIT)) {
        const n = nameFromSegment(seg);
        if (n) return { name: n, method: "contact_line", confidence: "high" };
      }
    }
  }

  // A name printed twice — glued ("Asha RaoAsha Rao") or on consecutive lines.
  for (let i = 0; i < lines.length; i++) {
    const toks = unglue(lines[i]).split(/\s+/);
    const half = toks.length / 2;
    if (toks.length >= 4 && toks.length <= 8 && Number.isInteger(half) &&
        toks.slice(0, half).join(" ").toLowerCase() === toks.slice(half).join(" ").toLowerCase() && looksLikeName(toks.slice(half).join(" "))) {
      return { name: normalizeName(toks.slice(half).join(" ")), method: "repeated", confidence: "high" };
    }
    if (i + 1 < lines.length && lines[i].toLowerCase() === lines[i + 1].toLowerCase() && looksLikeName(lines[i])) {
      return { name: normalizeName(lines[i]), method: "repeated", confidence: "high" };
    }
  }

  // Last resort: a name-shaped header line. Low confidence — AI steps stay blocked until the founder confirms.
  for (const line of lines.slice(0, 6)) {
    const head = line.split(SEGMENT_SPLIT)[0].trim();
    if (looksLikeName(head)) return { name: normalizeName(head), method: "header", confidence: "low" };
  }
  return { name: null, method: "none", confidence: null };
}

function normalizeName(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t === t.toUpperCase() ? toTitleCase(t) : t;
}

// Non-name words commonly found in CV file names.
const FILE_STOPWORDS = new Set(
  "pm spm cv resume final updated new copy draft application applicant candidate product manager senior sr jr junior strong weak ambiguous fixture test doc docx pdf txt latest version".split(" "),
);

/**
 * Words from the file name that are probably the candidate's name ("01_asha_rao.pdf" -> asha, rao).
 * Used only as a tripwire: if two of them appear side by side in text bound for Gemini, the call is blocked.
 */
export function fileNameTokens(fileName: string): string[] {
  return fileName
    .replace(/\.[a-z0-9]+$/i, "")
    .split(/[^\p{L}]+/u)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length >= 3 && !FILE_STOPWORDS.has(t));
}

/** Name tokens worth redacting on their own (skip initials like "S."). */
export function nameTokens(name: string): string[] {
  return name
    .split(/\s+/)
    .map((w) => w.replace(/[.,]/g, ""))
    .filter((w) => w.length >= 3);
}

function replaceWord(text: string, word: string, placeholder: string): string {
  const re = new RegExp(`(?<![\\p{L}])${escapeRe(word)}(?![\\p{L}])`, "giu");
  return text.replace(re, placeholder);
}

export function splitPii(raw: string, opts: { name?: string; fileName?: string } = {}): { personal: PersonalDetails; redacted: string } {
  const warnings: string[] = [];
  let text = raw;

  // 1. Emails (first — they often contain name tokens).
  const emails = [...new Set(raw.match(EMAIL_RE) ?? [])];
  text = text.replace(EMAIL_RE, "[CONTACT]");

  // 2. URLs — profile links are contact details; others may embed the name in the path.
  const links: string[] = [];
  text = text.replace(URL_RE, (m) => {
    links.push(m);
    return PROFILE_URL_RE.test(m) ? "[CONTACT]" : "[LINK]";
  });

  // 3. Phones.
  const phones: string[] = [];
  text = text.replace(PHONE_RE, (m) => {
    if (!isPhone(m)) return m;
    phones.push(m.trim());
    return "[CONTACT]";
  });

  // 4. Candidate name — full string, then each token (catches "Priya's", surname-only mentions), then
  //    the name run together ("kabirmehta" in a profile slug). A founder-entered name overrides detection.
  const detection: NameDetection = opts.name?.trim()
    ? { name: normalizeName(opts.name), method: "founder", confidence: "founder" }
    : detectName(raw);
  const name = detection.name;
  if (name) {
    text = text.replace(new RegExp(escapeRe(name).replace(/\\? /g, "\\s+"), "gi"), "[CANDIDATE]");
    for (const tok of nameTokens(name)) text = replaceWord(text, tok, "[CANDIDATE]");
    const joined = nameTokens(name).join("");
    if (joined.length >= 6) text = text.replace(new RegExp(escapeRe(joined), "gi"), "[CANDIDATE]");
    if (detection.confidence === "low") warnings.push("name_low_confidence");
  } else {
    warnings.push("name_not_detected");
  }

  // 5. Third-party names in attributions: `— Rahul Menon, Engineering Lead` -> `— [REFERENCE], Engineering Lead`.
  const thirdParty: string[] = [];
  // The dash must stand alone at the start of a line ("— Rahul Menon, Engineering Lead"), never inside a
  // word ("Co-Founder", "AI-Driven") or a date range ("Oct 2022 – Present"); and the words must look like a
  // real 2–3 word person name. Both rules came from false positives on the real applications/ CVs.
  const attribution = new RegExp(
    `((?:^|\\n)[ \\t]*[—–-] +|\\b(?:said|says|wrote|according to) +)(${NAME_2_3})(?=,? *(?:[\\p{L}& ]{0,40}\\b(?:${TITLE_WORDS})\\b))`,
    "gu",
  );
  text = text.replace(attribution, (m, prefix: string, who: string) => {
    if (!isLikelyPersonName(who)) return m;
    thirdParty.push(who);
    return `${prefix}[REFERENCE]`;
  });
  // 5b. Third-party names in running text. Pattern-based, not NER: it catches a 2–3 word capitalised
  // name in a person context (honorific, "worked with/reporting to/mentored by …", "Name (VP Sales)",
  // "Name, our CTO"), and skips anything that looks like an organisation or place.
  text = text.replace(HONORIFIC_NAME_RE, (m, prefix: string, who: string) => {
    if (who.split(/\s+/).some((t) => ORG_WORDS.has(t.toLowerCase().replace(/[’']s$/, "")) || NOT_A_NAME.has(t.toLowerCase()))) return m;
    thirdParty.push(`${prefix.trim()} ${who}`);
    return `${prefix}[REFERENCE]`;
  });
  text = text.replace(PERSON_CONTEXT_RE, (m, prefix: string, who: string) => {
    if (!isLikelyPersonName(who)) return m;
    thirdParty.push(who);
    return `${prefix}[REFERENCE]`;
  });
  text = text.replace(NAME_BEFORE_TITLE_RE, (m, who: string, rest: string) => {
    if (!isLikelyPersonName(who)) return m;
    thirdParty.push(who);
    return `[REFERENCE]${rest}`;
  });
  // Any later mention of a third party already found — full name, or first name alone — is redacted too.
  for (const entry of [...new Set(thirdParty)].filter((w) => !w.startsWith("["))) {
    const who = entry.replace(/^(?:Mr|Mrs|Ms|Miss|Dr|Prof)\.?\s+/, "");
    text = text.replace(new RegExp(escapeRe(who).replace(/\\? /g, "\\s+"), "g"), "[REFERENCE]");
    const first = who.split(/\s+/)[0];
    if (first.length >= 3 && who.includes(" ")) text = replaceWord(text, first, "[REFERENCE]");
  }

  // 6. Referees section: drop everything after a "References" heading.
  text = text.replace(/\n\s*references?\s*:?\s*\n[\s\S]*$/i, (m) => {
    if (/available on request/i.test(m)) return m;
    thirdParty.push("[references section]");
    return "\n\nReferences: [REFERENCES REDACTED]";
  });

  if (emails.length === 0) warnings.push("email_not_detected");
  if (phones.length === 0) warnings.push("phone_not_detected");
  if (emails.length > 1) warnings.push("multiple_emails");

  return {
    personal: {
      name,
      name_method: detection.method,
      name_confidence: detection.confidence,
      tripwire_tokens: opts.fileName ? fileNameTokens(opts.fileName) : [],
      email: emails[0] ?? null,
      phone: phones[0] ?? null,
      other_emails: emails.slice(1),
      other_phones: phones.slice(1),
      links,
      third_party_names: thirdParty,
      warnings,
    },
    redacted: text,
  };
}

export interface PiiCheck {
  ok: boolean;
  leaks: { kind: "email" | "phone" | "name" | "link"; sample: string }[];
}

/**
 * Independent leak detector, run on the exact payload before every Gemini call.
 *  - `candidateContent` (redacted CV / extracted profile): checked for email + phone shapes AND
 *    this candidate's own name tokens and links.
 *  - `staticContext` (the rubric, fixed instructions): checked for email + phone shapes only —
 *    the rubric names past hires, which would false-positive against a candidate sharing a first name.
 * Samples are masked so the audit log itself doesn't store the leak.
 */
export function findPii(
  candidateContent: string,
  personal: PersonalDetails | null | undefined,
  staticContext = "",
): PiiCheck {
  const leaks: PiiCheck["leaks"] = [];
  const mask = (s: string) => (s.length <= 2 ? "**" : s[0] + "*".repeat(Math.min(s.length - 2, 8)) + s.at(-1));
  const all = candidateContent + "\n" + staticContext;

  for (const m of all.match(EMAIL_RE) ?? []) leaks.push({ kind: "email", sample: mask(m) });
  for (const m of all.match(PHONE_RE) ?? []) if (isPhone(m)) leaks.push({ kind: "phone", sample: mask(m) });

  // Tripwire: two file-name words side by side ("Asha Rao", "asha-rao") in candidate content
  // means the name probably slipped past detection — block even though the guard doesn't "know" it.
  const tw = personal?.tripwire_tokens ?? [];
  for (let i = 0; i + 1 < tw.length; i++) {
    if (new RegExp(`(?<![\\p{L}])${escapeRe(tw[i])}[\\s._-]*${escapeRe(tw[i + 1])}(?![\\p{L}])`, "iu").test(candidateContent)) {
      leaks.push({ kind: "name", sample: mask(`${tw[i]} ${tw[i + 1]}`) });
    }
  }
  if (personal?.name) {
    const joined = nameTokens(personal.name).join("");
    if (joined.length >= 6 && candidateContent.toLowerCase().includes(joined.toLowerCase())) leaks.push({ kind: "name", sample: mask(joined) });
    for (const tok of nameTokens(personal.name)) {
      if (new RegExp(`(?<![\\p{L}])${escapeRe(tok)}(?![\\p{L}])`, "iu").test(candidateContent)) {
        leaks.push({ kind: "name", sample: mask(tok) });
      }
    }
  }
  for (const l of personal?.links ?? []) if (candidateContent.includes(l)) leaks.push({ kind: "link", sample: mask(l) });
  for (const entry of personal?.third_party_names ?? []) {
    if (entry.startsWith("[")) continue;
    const who = entry.replace(/^(?:Mr|Mrs|Ms|Miss|Dr|Prof)\.?\s+/, "");
    if (new RegExp(`(?<![\\p{L}])${escapeRe(who).replace(/\\? /g, "\\s+")}(?![\\p{L}])`, "u").test(candidateContent)) {
      leaks.push({ kind: "name", sample: mask(who) });
    }
  }

  return { ok: leaks.length === 0, leaks };
}
