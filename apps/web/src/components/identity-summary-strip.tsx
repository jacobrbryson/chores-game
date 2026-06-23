"use client";

import { useLocale } from "@/components/locale-provider";
import { topEarnedIdentities, type PillarIdentity } from "@/lib/responsibility/identity";
import { responsibilityTitleLabel } from "@/lib/responsibility/labels";
import { RESPONSIBILITY_PILLAR_EMOJI } from "@/lib/responsibility/types";

// Compact, presentational list of a child's earned identities — "who they are"
// — used on profile cards, kiosk/switch selection tiles, and the parent Family
// Growth section. Takes already-loaded identities so it never fetches; renders
// nothing when the child hasn't started any pillar.
export function IdentitySummaryStrip({
  identities,
  limit = 3,
  variant = "rows",
  className = "",
}: {
  identities: PillarIdentity[];
  limit?: number;
  // "rows": stacked emoji + title lines (profile). "chips": inline pills
  // (selection tiles, family growth).
  variant?: "rows" | "chips";
  className?: string;
}) {
  const { t } = useLocale();
  const top = topEarnedIdentities(identities, limit);
  if (top.length === 0) {
    return null;
  }
  return (
    <div
      className={`identity-strip identity-strip-${variant}${className ? ` ${className}` : ""}`}>
      {top.map((entry) => (
        <span key={entry.pillar} className="identity-strip-item">
          <span aria-hidden="true">{RESPONSIBILITY_PILLAR_EMOJI[entry.pillar]}</span>
          <span>{responsibilityTitleLabel(entry.pillar, entry.titleTier, t)}</span>
        </span>
      ))}
    </div>
  );
}
