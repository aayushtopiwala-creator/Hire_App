import { CATEGORIES, CATEGORY_META, type Scores } from "@/lib/types";

export function band(total: number): "high" | "mid" | "low" {
  return total >= 8 ? "high" : total >= 5 ? "mid" : "low";
}

export function ScoreChip({ total }: { total: number | null }) {
  if (total === null) return <span className="chip pending">—</span>;
  const b = band(total);
  return (
    <span className={`chip ${b === "mid" ? "" : b}`} title={`${total} / 10`}>
      {Number.isInteger(total) ? total.toFixed(1) : String(total)}
    </span>
  );
}

/** Six segments, each as wide as that category's max points, filled to the score. */
export function SegmentBar({ scores, legend = false }: { scores: Scores | null; legend?: boolean }) {
  return (
    <div>
      <div className="segbar" aria-label="Category breakdown">
        {CATEGORIES.map((c) => {
          const { max } = CATEGORY_META[c];
          const v = scores?.[c] ?? 0;
          return (
            <div key={c} className={`seg ${scores && v >= max ? "full" : ""}`} style={{ flexGrow: max, flexBasis: 0 }} title={`${c} · ${CATEGORY_META[c].label}: ${v}/${max}`}>
              {scores && <i style={{ width: `${(v / max) * 100}%` }} />}
            </div>
          );
        })}
      </div>
      {legend && (
        <div className="segbar-legend">
          {CATEGORIES.map((c) => (
            <span key={c} style={{ flexGrow: CATEGORY_META[c].max, flexBasis: 0 }}>
              {c}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
