# Kargo Hiring Desk: summary

## What it does

The Hiring Desk is a private, single-user web app (Next.js on Vercel, Supabase, Gemini, Resend) that takes a folder of CVs for two open roles, Product Manager (PM) and Senior Product Manager (SPM), and turns them into ranked shortlists with draft emails. The founder reviews every draft and sends each one by hand.

1. **Import.** CVs (PDF, DOCX or TXT) are parsed on this machine. Name, email, phone, links and referee names are moved into a private field, and the rest of the text is redacted. No AI is involved at this stage.
2. **Role.** A role in the file name (`pm_`, `spm_` and variants) is taken as the applicant's own choice. Otherwise Gemini guesses PM or SPM. The guess is auto-confirmed only when it's clear; everything else goes to the founder on the Role review tab.
3. **Extract and score.** Gemini extracts a structured profile from the redacted CV, then scores it against `rubric.txt`. Each score is the median of 3 runs, and every category score comes with a justification grounded in the profile.
4. **Rank and draft.** Each pool's interview shortlist is cut at its largest natural score gap. The shortlist gets an interview invite plus a 3-sentence brief for the founder; everyone else gets a personalised rejection that gives no reason.
5. **Review and send** (`/review`). One screen lists the invites first, then the rejections. Every email is sent only after an explicit two-step confirmation for that single candidate.

Supporting views:
- **Shortlist (`/`):** the ranking with each candidate's full score breakdown.
- **AI audit log (`/audit`):** the exact payload of every Gemini call.

Setup and scripts are in [README.md](README.md). Every rubric and prompt change, with its reason, is in [RUBRIC_CHANGELOG.md](RUBRIC_CHANGELOG.md).

## The rubric's core finding

`rubric.txt` was built by reading the CVs of Kargo's **8 existing hires** against their performance outcomes, not from the job descriptions alone.

**The hidden pattern is Category A, hands-on, ground-level logistics operations.** Every hire rated "Exceeds Expectations", across five different functions, had sustained hands-on experience inside freight forwarding, customs, port or supply-chain operations *before* their current specialty. None of the "Meets" or "Below" hires did.

Both job descriptions mention this only as a soft advantage, so it is the hidden pattern rather than a stated requirement. It's weighted 3 of the 10 points.

**Pedigree is deliberately down-weighted.** The hire with the most decorated background reached only "Meets", while a B.Com graduate reached "Exceeds". An impressive MBA or title never substitutes for evidence in Category A (ops immersion) or Category B (shipping and killing things).

## Hard constraints, and why each one exists

| Constraint | Why | Where it's enforced |
|---|---|---|
| **No auto-send, no bulk send, ever.** Each email needs the founder's own explicit "Confirm & Send", then "Send now", for that one candidate. | A rejection or invite sent in error can't be taken back, and a bulk action makes it easy to send dozens in error. This is the one step that stays manual permanently. **A request to add multi-select, "confirm all" or bulk send is a stop-and-ask, never a feature.** | `lib/email/send.ts` is the only Resend import; `/api/candidates/[id]/confirm` is its only caller and acts on one ID. A send lock blocks double-sends. `tests/send-path.test.ts` and `tests/review.test.ts` fail if a bulk path appears. |
| **No personal data in any Gemini call.** This covers candidate name, email, phone, links and referee names, plus the names of past hires and the founder. | Candidate data shouldn't leave the building just to be scored. Redacting first and checking every payload makes this verifiable rather than a promise. | `lib/pii.ts` redacts the text. `lib/gemini.ts` runs a guard on every payload and blocks the call if it finds anything, including when the candidate's name isn't confidently known. Every payload is logged in `ai_calls` and shown at `/audit`. `tests/prompts.test.ts` checks that no person's name appears in any prompt. |
| **Every score has an evidence-based justification.** | A bare number can't be checked or challenged. | The model must return its output in a fixed format. `normalizeScores` enforces the rubric's arithmetic and rejects an empty justification. Quotation marks must match the CV word for word, and gendered pronouns are rejected. |
| **`EMAIL_TEST_RECIPIENT` stays set** until the founder explicitly asks for it to be removed. | While the system is new, every "send" goes to the founder's own inbox, so mistakes cost nothing. | `resolveRecipient()` in `lib/email/validate.ts` makes the redirect override the candidate's address. It **fails closed**: if the variable is missing (e.g. forgotten on a new deployment), sending is blocked. A real candidate can only be emailed if `ALLOW_REAL_SENDS=true` is set deliberately. A banner shows on every page, and the confirmation box names the real destination. |
| **Only Arjun can access the app.** | Candidate data, scores and the send button are behind one account. | Supabase Auth email and password, with no sign-up anywhere; the single account is created by `npm run auth:create-user`. `proxy.ts` gates every request, and every page and API route re-checks the session server-side against `ALLOWED_EMAIL` (fails closed if unset), enforced by `tests/auth.test.ts`. |

## Known limitations

- **The SPM rubric is extrapolated.** No past Senior PM hire exists to calibrate it against. Its stricter Category A reading comes from the pattern across other functions plus the SPM job description's own wording.
- **Third-party name redaction is pattern-based, not true name recognition.** A bare first name with no honorific and no context phrase (e.g. "worked with Priya on…") is not caught. Two-to-three-word names after "worked with / reporting to / mentored by…", honorifics ("Dr. Sharma") and attribution lines ("— Name, Title") are caught.
- **Scanned or image-only PDFs** are rejected; there is no OCR.
- **Scores carry some model noise.** The median of 3 runs damps it, but a ±0.5 shift on a single category is still possible between full re-scores. Each candidate's scoring notes record where the runs disagreed.
- **Source control:** `applications/`, `hires/` and `rubric.txt` (which names employees with their ratings) are never committed. The deployed app reads the rubric from Supabase.
- **Real delivery needs a verified sending domain in Resend.** Without one, Resend only delivers from `onboarding@resend.dev` to the account owner's address. That's fine while the test redirect is on, but must be sorted before real sends.
