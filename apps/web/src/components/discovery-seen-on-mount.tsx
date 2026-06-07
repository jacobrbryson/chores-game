"use client";

import { useMarkDiscoverySeen } from "@/lib/hooks/use-discovery";

type DiscoverySeenOnMountProps = {
  sections: string[];
};

// Drop-in client marker for server-rendered pages: marks the given discovery
// sections seen for the active profile once the page is visibly mounted. Only
// use on pages whose route the user has actually navigated to (never inside a
// hidden/mounted dashboard panel).
export function DiscoverySeenOnMount({ sections }: DiscoverySeenOnMountProps) {
  useMarkDiscoverySeen(sections, true);
  return null;
}
