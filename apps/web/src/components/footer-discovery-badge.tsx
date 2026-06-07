"use client";

import { DiscoveryBadge } from "@/components/discovery-badge";
import { getSectionCount, useDiscoverySummary } from "@/lib/hooks/use-discovery";

type FooterDiscoveryBadgeProps = {
  // One or more discovery sections whose counts are summed into the badge (e.g.
  // the footer Change Log link covers both the Recent and Requested tabs).
  sections: string[];
  enabled?: boolean;
};

// Client wrapper that surfaces discovery section counts as a badge on a footer
// link (the footer itself is a server component). Disabled for logged-out
// visitors so we don't fire authed-only discovery requests.
export function FooterDiscoveryBadge({ sections, enabled = true }: FooterDiscoveryBadgeProps) {
  const { summary } = useDiscoverySummary(sections, { enabled });
  if (!enabled) {
    return null;
  }
  const total = sections.reduce((sum, section) => sum + getSectionCount(summary, section), 0);
  return <DiscoveryBadge count={total} />;
}
