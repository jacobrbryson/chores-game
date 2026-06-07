import { isSectionVisibleToRole } from "@/lib/discovery/sections";
import type { DiscoverySectionKey, ViewerRole } from "@/lib/discovery/types";

function normalizeAlias(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

// Builds the identity aliases for the active profile used to match items
// (chores, awards) assigned to them. Mirrors the alias model used across the
// codebase: uid, member doc id, and lowercased email.
export function buildViewerAliases(input: {
  uid: string;
  memberId?: string;
  email?: string;
  extra?: string[];
}): string[] {
  const aliases = new Set<string>();
  for (const value of [input.uid, input.memberId, input.email, ...(input.extra ?? [])]) {
    const normalized = normalizeAlias(value);
    if (normalized) {
      aliases.add(normalized);
    }
  }
  return Array.from(aliases);
}

// Whether the viewer (active profile) may MARK a section as seen. A viewer can
// only mark sections their role is allowed to see; child/player users cannot
// mark admin-only sections.
export function canViewerMarkSectionSeen(
  sectionKey: DiscoverySectionKey,
  role: ViewerRole,
): boolean {
  return isSectionVisibleToRole(sectionKey, role);
}

// Whether the viewer may receive a count for a section. Same gate as marking —
// discovery must never expose existence of data the viewer cannot access.
export function canViewerSeeSection(
  sectionKey: DiscoverySectionKey,
  role: ViewerRole,
): boolean {
  return isSectionVisibleToRole(sectionKey, role);
}
