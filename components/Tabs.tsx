import Link from "next/link";

export type TabKey = "REVIEW" | "PM" | "SPM";

// Each tab works out its own shortlist size (pools have different natural breaks), so links don't carry ?n.
export function RoleTabs({ active, counts }: { active: TabKey; counts: Record<TabKey, number>; topN?: number }) {
  const tabs: { key: TabKey; label: string }[] = [
    { key: "REVIEW", label: "Role review" },
    { key: "PM", label: "Product Manager" },
    { key: "SPM", label: "Senior PM" },
  ];
  return (
    <nav className="tabs">
      {tabs.map((t) => (
        <Link key={t.key} href={`/?role=${t.key}`} className="tab" aria-current={t.key === active ? "page" : undefined}>
          {t.label}
          <span className={`mono ${t.key === "REVIEW" && counts.REVIEW > 0 ? "attn" : ""}`}>{counts[t.key]}</span>
        </Link>
      ))}
    </nav>
  );
}
