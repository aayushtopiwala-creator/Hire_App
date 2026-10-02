import assert from "node:assert/strict";
import { test } from "node:test";
import { suggestTopN } from "../lib/shortlist";

test("cuts at the largest drop between ranks 3 and 8", () => {
  assert.deepEqual(suggestTopN([9, 9, 8.75, 8.5, 7.5, 5.75, 5.5, 5.25, 4]), { n: 5, gap: 1.75, above: 7.5, below: 5.75 });
  assert.equal(suggestTopN([9, 9, 9, 8.5, 7, 6.5, 5.5]).n, 4); // 8.5 -> 7 (1.5) beats 7 -> 6.5
});

test("ties go to the cut nearest the default; tiny pools invite everyone", () => {
  assert.equal(suggestTopN([8, 7, 6, 5, 4, 3, 2, 1, 0]).n, 5);
  assert.equal(suggestTopN([9, 8]).n, 2);
});
