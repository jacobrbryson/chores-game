import type {
  DiscoveryAudience,
  DiscoverySectionDefinition,
  DiscoverySectionKey,
  ViewerRole,
} from "@/lib/discovery/types";

// Single source of truth for discovery sections. New discoverable features
// should register a section here and contribute a count in counts.ts — never
// add one-off badge logic directly to a feature.
export const DISCOVERY_SECTIONS: DiscoverySectionDefinition[] = [
  { key: "chores", audience: "all", labelKey: "discovery.sections.chores" },
  { key: "store", audience: "all", labelKey: "discovery.sections.store" },
  {
    key: "store:customize_colors",
    parentKey: "store",
    audience: "all",
    labelKey: "discovery.sections.storeCustomizeColors",
    storeCategoryId: "customize_colors",
  },
  {
    key: "store:customize_avatar",
    parentKey: "store",
    audience: "all",
    labelKey: "discovery.sections.storeCustomizeAvatar",
    storeCategoryId: "customize_avatar",
  },
  {
    key: "store:victory_confetti",
    parentKey: "store",
    audience: "all",
    labelKey: "discovery.sections.storeVictoryConfetti",
    storeCategoryId: "victory_confetti",
  },
  {
    key: "store:family_awards",
    parentKey: "store",
    audience: "all",
    labelKey: "discovery.sections.storeFamilyAwards",
    storeCategoryId: "family_awards",
  },
  {
    key: "store:quest_items",
    parentKey: "store",
    audience: "all",
    labelKey: "discovery.sections.storeQuestItems",
    storeCategoryId: "quest_items",
  },
  { key: "quests", audience: "all", labelKey: "discovery.sections.quests" },
  { key: "achievements", audience: "all", labelKey: "discovery.sections.achievements" },
  { key: "changelog", audience: "all", labelKey: "discovery.sections.changelog" },
  { key: "requested_changes", audience: "all", labelKey: "discovery.sections.requestedChanges" },
  // Community awards browsing/copying is parent-managed; children never get
  // community discovery counts.
  { key: "community_awards", audience: "admin", labelKey: "discovery.sections.communityAwards" },
];

const SECTION_BY_KEY = new Map<string, DiscoverySectionDefinition>(
  DISCOVERY_SECTIONS.map((section) => [section.key, section]),
);

// Best-effort English fallback labels used when a localized label is not
// resolved (the client localizes by labelKey).
const FALLBACK_LABELS: Record<DiscoverySectionKey, string> = {
  chores: "Chores",
  store: "Store",
  "store:customize_colors": "Colors",
  "store:customize_avatar": "Avatars",
  "store:victory_confetti": "Confetti",
  "store:family_awards": "Family Awards",
  "store:quest_items": "Quest Items",
  quests: "Quests",
  achievements: "Achievements",
  changelog: "Change Log",
  requested_changes: "Requested Changes",
  community_awards: "Community Awards",
};

export function isDiscoverySectionKey(value: string): value is DiscoverySectionKey {
  return SECTION_BY_KEY.has(value);
}

// Validates and canonicalizes a section key. Returns null for unknown sections
// so callers can return a validation error.
export function normalizeDiscoverySection(
  section: string,
): DiscoverySectionKey | null {
  const trimmed = section.trim();
  return isDiscoverySectionKey(trimmed) ? trimmed : null;
}

export function getDiscoverySection(
  key: DiscoverySectionKey,
): DiscoverySectionDefinition {
  const section = SECTION_BY_KEY.get(key);
  if (!section) {
    throw new Error(`UNKNOWN_DISCOVERY_SECTION_${key}`);
  }
  return section;
}

export function getDiscoverySectionFallbackLabel(key: DiscoverySectionKey): string {
  return FALLBACK_LABELS[key];
}

function audienceAllowsRole(audience: DiscoveryAudience, role: ViewerRole): boolean {
  if (audience === "all") {
    return true;
  }
  return audience === role;
}

// Whether a section's badge may be shown to (and counted for) the given role.
export function isSectionVisibleToRole(
  key: DiscoverySectionKey,
  role: ViewerRole,
): boolean {
  const section = SECTION_BY_KEY.get(key);
  if (!section) {
    return false;
  }
  return audienceAllowsRole(section.audience, role);
}

export function listSectionsForRole(role: ViewerRole): DiscoverySectionDefinition[] {
  return DISCOVERY_SECTIONS.filter((section) =>
    audienceAllowsRole(section.audience, role),
  );
}

export function listChildSections(
  parentKey: DiscoverySectionKey,
): DiscoverySectionDefinition[] {
  return DISCOVERY_SECTIONS.filter((section) => section.parentKey === parentKey);
}
