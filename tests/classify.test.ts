import assert from "node:assert/strict";
import { test } from "node:test";
import { decideRoleStatus } from "../lib/ai/classify";

const base = { stated_role: "none" as const, stated_role_quote: "", pm_years: 3, total_years: 6, most_recent_title: "Product Manager", ownership_scope: "", model_confidence: "high" as const };

test("a verified stated role auto-confirms and wins", () => {
  const d = decideRoleStatus({ ...base, stated_role: "SPM", stated_role_quote: "Applying for: Senior Product Manager", stated_quote_verified: true, pm_years: 2, model_confidence: "low" }, "SPM");
  assert.deepEqual([d.status, d.role], ["auto_confirmed", "SPM"]);
});

test("an unverified stated role does not auto-confirm", () => {
  const d = decideRoleStatus({ ...base, stated_role: "SPM", stated_quote_verified: false, model_confidence: "medium" }, "SPM");
  assert.equal(d.status, "needs_confirmation");
});

test("high confidence auto-confirms only clear of the 4–5 year boundary", () => {
  assert.equal(decideRoleStatus({ ...base, pm_years: 3.5 }, "PM").status, "auto_confirmed");
  assert.equal(decideRoleStatus({ ...base, pm_years: 4 }, "PM").status, "needs_confirmation");
  assert.equal(decideRoleStatus({ ...base, pm_years: 5 }, "SPM").status, "needs_confirmation");
  assert.equal(decideRoleStatus({ ...base, pm_years: 5.5 }, "SPM").status, "auto_confirmed");
  // guess and band disagree -> founder decides
  assert.equal(decideRoleStatus({ ...base, pm_years: 7 }, "PM").status, "needs_confirmation");
});

test("medium or low confidence never auto-confirms", () => {
  assert.equal(decideRoleStatus({ ...base, pm_years: 2, model_confidence: "medium" }, "PM").status, "needs_confirmation");
  assert.equal(decideRoleStatus({ ...base, pm_years: 8, model_confidence: "low" }, "SPM").status, "needs_confirmation");
});
