/**
 * Interview shortlist size from the score distribution: cut at the largest drop between consecutive
 * ranks, looking at cuts that leave 3–8 invitees. Ties go to the cut closest to the default.
 * (Standing rule: a natural break in the scores beats a rigid fixed N.)
 */
export interface ShortlistSuggestion {
  n: number;
  gap: number;
  above: number | null; // score at rank n
  below: number | null; // score at rank n + 1
}

export function suggestTopN(scoresDesc: number[], fallback = 5, min = 3, max = 8): ShortlistSuggestion {
  if (scoresDesc.length <= min) return { n: scoresDesc.length, gap: 0, above: scoresDesc.at(-1) ?? null, below: null };
  let best: ShortlistSuggestion | null = null;
  for (let k = min; k <= Math.min(max, scoresDesc.length - 1); k++) {
    const gap = Math.round((scoresDesc[k - 1] - scoresDesc[k]) * 100) / 100;
    const better = !best || gap > best.gap || (gap === best.gap && Math.abs(k - fallback) < Math.abs(best.n - fallback));
    if (better) best = { n: k, gap, above: scoresDesc[k - 1], below: scoresDesc[k] };
  }
  return best ?? { n: Math.min(fallback, scoresDesc.length), gap: 0, above: null, below: null };
}
