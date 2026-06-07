"use client";

import { useLocale } from "@/components/locale-provider";
import { DISCOVERY_COUNT_DISPLAY_CAP } from "@/lib/discovery/types";

type DiscoveryBadgeProps = {
  count: number;
  // "inline" sits next to its label; "absolute" pins to the top-right of a
  // positioned parent (e.g. a nav chip or avatar).
  variant?: "inline" | "absolute";
  className?: string;
};

// Shared red numeric discovery badge. Renders nothing when count <= 0, shows
// "99+" past the display cap, and carries an accessible label so the count is
// announced to screen readers. Reused across nav chips, tabs, buttons, menu
// items, and cards — never reimplement badge markup per feature.
export function DiscoveryBadge({ count, variant = "inline", className }: DiscoveryBadgeProps) {
  const { t } = useLocale();
  if (!count || count <= 0) {
    return null;
  }
  const display = count > DISCOVERY_COUNT_DISPLAY_CAP ? `${DISCOVERY_COUNT_DISPLAY_CAP}+` : String(count);
  const classes = [
    "discovery-badge",
    variant === "absolute" ? "discovery-badge-absolute" : "discovery-badge-inline",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={classes} role="status" aria-label={t("discovery.badgeLabel", { count })}>
      <span aria-hidden="true">{display}</span>
    </span>
  );
}
