import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { roleFromFileName } from "../lib/roleMarker";

test("markers in this batch's naming scheme", () => {
  assert.equal(roleFromFileName("pm_02_asha_rao.pdf"), "PM");
  assert.equal(roleFromFileName("spm_26_tara_bose.pdf"), "SPM");
  assert.equal(roleFromFileName("01_dev_anand.pdf"), null);
});

test("variants: casing, separators, senior/sr spellings, position", () => {
  for (const f of ["SPM-ravi.pdf", "Spm_ravi.docx", "senior_pm_ravi.pdf", "Senior-PM ravi.pdf", "sr.pm_ravi.txt", "ravi_SPM.pdf", "srpm_ravi.pdf"]) assert.equal(roleFromFileName(f), "SPM", f);
  for (const f of ["PM-ravi.pdf", "Pm ravi.pdf", "ravi_pm.pdf", "ravi-PM.docx"]) assert.equal(roleFromFileName(f), "PM", f);
});

test("not markers: role words inside names, job-title words, ambiguity", () => {
  for (const f of ["pmohan_kumar.pdf", "spmukherjee.pdf", "product_manager_resume.pdf", "ravi_cv.pdf", "spm_pm_ravi.pdf"]) assert.equal(roleFromFileName(f), null, f);
});

// applications/ holds real CVs and is never committed, so this only runs on the machine that has it.
test("the real applications/ folder: 15 PM, 15 SPM, 30 unmarked", { skip: !existsSync("applications") && "no applications/ folder here" }, () => {
  const counts = { PM: 0, SPM: 0, none: 0 };
  for (const f of readdirSync("applications")) counts[roleFromFileName(f) ?? "none"]++;
  assert.deepEqual(counts, { PM: 15, SPM: 15, none: 30 });
});
