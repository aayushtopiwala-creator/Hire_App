# Rubric & scoring-payload changelog

`rubric.txt` is the human-readable source of truth. Each change is seeded as a new `rubric_versions`
row (old rows kept), and every candidate's `rubric_version_id` records which version scored them.

| Date | Change | Why | Re-scored |
|---|---|---|---|
| 2026-09-30 | v2 → v2.1: A anchor 1 adds "(b) real hands-on ops, but brief (< ~6 months)"; A anchor 2 "> ~6 months / one step removed". E anchors 0 and 0.25 tightened (a generic degree is not "some relevant qualification"). | A 3-month reporting internship got A=2; a general B.Com got E=0.25. | 3 fixtures |
| 2026-09-30 | E anchor 0.5 defined: (a) directly relevant degree, (b) ≥ 2 relevant certifications, or (c) an advanced relevant credential; one vocational cert plus an unrelated degree stays 0.25. | "Strong, clearly relevant" was a judgment call with no definition. | 3 fixtures |
| 2026-10-01 | D anchor 0.5 now covers a pivot from a genuinely unrelated field (default 0.5 unless PM/ops time itself shows growth); D anchor 1 requires "a coherent track". | Six years as a fashion consultant before PM was scored as a "clear upward trajectory" (D=1). | all 60 |
| 2026-10-01 | F: a voice statement must express a stance on HOW/WHY the candidate works, not a restated duty. | "Owned X end-to-end, not from a desk" (a duty bullet) was scored as a philosophy statement (F=1). | all 60 |
| 2026-10-01 | Scoring payload (code, `lib/rubric.ts`): lead-in paragraphs whose bullet list names past hires are now kept (minus any sentence naming someone) instead of dropped whole. | The stripper had been silently removing A's core finding ("every Exceeds hire had sustained hands-on ops experience BEFORE their specialty") and F's intro ("what the Exceeds hires share is a distinct point of view…") from every scoring call since the stripper rewrite. | all 60 |
| 2026-10-01 | Scoring prompt (code): Category A needs BOTH hands-on work AND logistics/supply-chain operations, replacing "judge ownership_level, not industry". | The old line was read as "industry doesn't matter": hospital-ward administration scored A=2. | all 60 |
| 2026-10-01 | Scoring prompt (code): Category A names supply-chain PLANNING (demand/inventory/distribution/carrier planning) explicitly. | The first version of the BOTH rule under-credited planning work (FMCD demand/inventory planning, 2y 8m → A=0). The rubric's anchor 3 names supply-chain planning, and its Exceeds example is a Supply Chain Analyst. | 36 with ops evidence |
| 2026-10-01 | Scoring method (code): median of 3 independent runs per category, with the justification taken from a run at the median; disagreements recorded in `_adjustments`. | The same profile scored C ±0.5, and occasionally A ±1, between runs (6 of 72 category scores varied in a 12×3 probe). | all 60 |
