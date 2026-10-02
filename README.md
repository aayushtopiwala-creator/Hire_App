# Kargo Hiring Desk

Local tool for ranking PM and SPM applicants against `rubric.txt` (v2) and drafting interview-invite and rejection emails. Nothing is ever sent until the founder clicks **Confirm & Send** for one candidate.

## Setup

```bash
npm install
cp .env.example .env.local      # fill in Supabase, Gemini, Resend
npm run db:migrate              # applies supabase/migrations/*.sql and seeds rubric.txt into rubric_versions
npm run dev                     # http://localhost:3000
```

## Access and deployment

The app is private to **one person**. Sign-in is by email and password (Supabase Auth), and only the address in `ALLOWED_EMAIL` can get in:

- **There is no sign-up anywhere in the app.** The one account is created with `npm run auth:create-user`, which asks for the password in your terminal with typing hidden and never prints or stores it. `-- --reset` changes the password.
- **`proxy.ts`** sends every signed-out page request to `/login` and returns `401` for API calls.
- **Every page and API route re-checks on the server** that the signed-in email is `ALLOWED_EMAIL`. If `ALLOWED_EMAIL` is unset, nobody gets in. `tests/auth.test.ts` fails if a page or route is added without the check.
- **Supabase dashboard:** Authentication → Sign In / Providers → turn **off "Allow new users to sign up"**. The app can't create accounts anyway, but this also closes Supabase's own sign-up endpoint.

**Deploying to Vercel:** import the GitHub repo (framework preset: Next.js, no build settings to change) and add these environment variables for Production:

| Variable | Value |
|---|---|
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → service_role / secret key |
| `SUPABASE_ANON_KEY` | Supabase → Project Settings → API → publishable / anon key |
| `ALLOWED_EMAIL` | Arjun's sign-in email |
| `GEMINI_API_KEY` | Google AI Studio key |
| `GEMINI_MODEL` | `gemini-3.8-flash` |
| `RESEND_API_KEY` | Resend API key |
| `EMAIL_FROM` | e.g. `Arjun Mehta <onboarding@resend.dev>` |
| `EMAIL_TEST_RECIPIENT` | the inbox all sends are redirected to. **If this is missing, sending is blocked.** |
| `SENDER_SIGNATURE` | optional; defaults to `Arjun Mehta\nFounder, Kargo` |
| `TOP_N_DEFAULT` | optional; defaults to `5` |

`DATABASE_URL` isn't needed on Vercel; it's only for running migrations from your machine. Never set `ALLOW_REAL_SENDS` unless Arjun has decided to email real candidates.

On the deployed app, the "Import applications/ folder" button reports that there's no folder; use **Upload CVs** instead. AI and upload routes are allowed up to 60 seconds each.

## Flow

0. **Mixed intake, optional.** Put CVs in `applications/` and click **Import applications/ folder** on the Role review tab, or run `npm run ingest:folder` (add `-- --classify` to also classify). Uploading with "Mixed — detect role" works the same way. Files with identical bytes are imported only once. A Gemini step (`classify`) then guesses PM or SPM with a confidence level and a one-line reason. A role is **auto-confirmed** only in two cases: the CV states the role and the statement is found word for word in the CV, or the model reports high confidence and PM years sit clearly inside one band (≤ 3.5 → PM, ≥ 5.5 → SPM). Everything else waits on the **Role review** tab, and low-confidence guesses are flagged "Uncertain — please confirm". Scoring refuses any candidate without a confirmed role, and drafting waits until no candidate is still missing a role.
1. **Upload CVs** (`/upload`): pick a role, then drop PDF, DOCX or TXT files. Each file is parsed on this machine. Name, email and phone go into `personal_details`. `cv_redacted_text` holds the CV with those replaced by `[CANDIDATE]` and `[CONTACT]`, links by `[LINK]`, and referee names by `[REFERENCE]` (their job titles are kept). No AI is involved in this step.
2. **Score pending** (shortlist page): runs Gemini call 1 (extraction to a structured profile) and call 2 (scoring against the rubric) for each unscored CV, three at a time.
3. **Generate drafts**: once everyone in the role is scored, Gemini call 3 writes an invite and a three-sentence brief for the top N (default 5, set in the toolbar). Everyone else gets a personalised rejection. Confirmed candidates and drafts you've edited are never overwritten, unless you click Regenerate on that row.
4. **Review and send**: open a row to see the score breakdown with justifications, the extracted profile, the brief and the editable email. **Confirm & Send** asks you again, then sends that one email through Resend.

## Guarantees and where they're enforced

| Guarantee | Enforced by |
| --- | --- |
| No PII in AI calls | `lib/gemini.ts` is the only Gemini caller. It runs `findPii` on the exact payload and blocks the call on any email, phone number, the candidate's name or their links. Every payload is stored in `ai_calls` and shown at `/audit`. |
| No real employee names sent to Gemini | `scoringRubric()` in `lib/rubric.ts` strips the named-hire calibration notes and refuses to run if any name survives. `rubric.txt` stays complete. |
| Names never go to Gemini | Drafts use `[FIRST_NAME]` and `[SENDER_SIGNATURE]` placeholders, which are filled in locally when the page renders and when the email is sent. No person's name appears in any prompt, the founder's included, and `tests/prompts.test.ts` enforces this. |
| Honest drafts | Rejections give no reason tied to the candidate's experience (`REJECTION_REASON` check plus a retry), and invites and briefs must quote the CV exactly. No email mentions scores, ranks or screening. |
| Stable scores | Every candidate is scored by the median of 3 independent runs per category, and any disagreement between runs is recorded on the row. |
| Every score is justified | The model returns scores through a response schema. `normalizeScores` enforces the allowed values, the total and the rule "E can only reach 0.5 alongside A/B evidence", and rejects any empty justification. Extracted quotes are checked against the CV word for word; unmatched ones are flagged in the UI. |
| No auto-send and no bulk send | `lib/email/send.ts` is the only file that imports Resend. Its only caller is `app/api/candidates/[id]/confirm`, which needs `confirm: true`. It takes a short send lock (`send_started_at`), then calls Resend, and only after Resend accepts the email marks the row `confirmed_sent`. A double click gets a 409, and a Resend idempotency key covers retries. All of this is enforced by `tests/send-path.test.ts`. |
| Quotes are real quotes | Quotation marks in score justifications must enclose exact CV text. `misquotes()` checks each one against the redacted CV and retries up to twice. After that, it drops the quotation marks and logs the change. |
| Safe testing | While `EMAIL_TEST_RECIPIENT` is set, every confirmed send goes to that address, and a banner says so on every page. |

## Batch scripts

```bash
npm run ingest:folder            # import applications/ (parse + PII split only); add -- --classify for the role step
npm run score:confirmed          # extract + score confirmed, unscored candidates; -- --all re-scores everyone
npm run draft:all                # drafts only: per pool, shortlist = natural score break (lib/shortlist.ts)
npx tsx scripts/reredact.ts      # re-run redaction after a PII-rule change (clears profiles that changed)
npm run db:migrate               # applies only new migrations (ledger: schema_migrations) + seeds rubric.txt
```

None of these can send email. Rubric changes are logged in [RUBRIC_CHANGELOG.md](RUBRIC_CHANGELOG.md).

## Tests

```bash
npm run test:unit      # parsing, PII split, rubric stripping, send-path and pre-send validation (offline)
npm run fixtures       # rebuild the 3 synthetic CVs (PDF/DOCX/TXT) in fixtures/
npm run test:phase1    # ingest one CV into Supabase, verify the PII split in the stored row
npm run test:phase2    # extract + score the 3 fixtures, check ordering and the PII audit
npm run test:phase3    # brief + drafts for the 3 fixtures
npm run test:phase5    # with the app running: negative confirm checks (never sends)
npm run test:phase5 -- --send   # ONE real send for the strong-PM fixture (to EMAIL_TEST_RECIPIENT)
```

## Known limits

- There's no OCR, so scanned or image-only PDFs are rejected with a clear message.
- Name detection: a `Name:` label, then the text beside the first email address (this handles designed PDFs that extract the header last, with the name glued to a duplicate of itself), then a name printed twice, then a header line. A header-only match is low confidence. **If the name isn't found, or is only low confidence, no Gemini call can run** until you enter the name on the Role review tab. As a tripwire, two words from the file name appearing side by side in a payload also block the call. On the 60 CVs in `applications/`, all 60 names were found next to the email address.
- A news-article URL that wraps onto a second line can leave its numeric tail (e.g. `111641647413270.html`) in the redacted text. It isn't personal data.
- Third-party names are redacted using patterns, not full name recognition. The patterns cover: attributions ("— Name, Title"); a References section; honorifics ("Dr. Sharma"); two- or three-word names after person phrases ("worked with…", "reporting to…", "mentored by…"); "Name (VP Sales)" and "Name, our CTO"; and later first-name-only mentions of anyone already found. Two cases are not caught: a single first name with no honorific ("worked with Priya on…"), and a name with no surrounding context phrase.
- `GEMINI_MODEL` defaults to `gemini-3.8-flash`. If that model isn't found, the app calls ListModels and uses the newest stable `gemini-X.Y-flash` model.
