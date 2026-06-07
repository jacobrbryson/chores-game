import type { AppLocale } from "@packages/locales";

// Discovery / What's New domain types.
//
// Discovery tracks seen/unseen *content* per active profile. It is intentionally
// separate from the notification (read/unread) system: notifications answer
// "what happened?", discovery answers "what is new since I last looked?".
//
// State is stored per active profile at `users/{profileUid}/discoveryState/{sectionKey}`
// using section-level last-seen timestamps (no per-item rows).

export type DiscoverySectionKey =
  | "chores"
  | "store"
  | "store:customize_colors"
  | "store:customize_avatar"
  | "store:victory_confetti"
  | "store:family_awards"
  | "store:quest_items"
  | "quests"
  | "achievements"
  | "changelog"
  | "community_awards";

// Who is allowed to see a section's badge. Counts are always computed with the
// viewer's actual access; audience is the coarse gate on top of that.
export type DiscoveryAudience = "all" | "admin" | "player";

export type ViewerRole = "admin" | "player";

export type DiscoverySectionDefinition = {
  key: DiscoverySectionKey;
  // Parent section for nested (store category) sections.
  parentKey?: DiscoverySectionKey;
  audience: DiscoveryAudience;
  // Locale key for the human label (resolved client-side; the server also
  // returns a best-effort English fallback label).
  labelKey: string;
  // For store category sections, the underlying store catalog category id.
  storeCategoryId?: string;
};

// The per-section discovery state document stored in Firestore.
export type DiscoveryStateRecord = {
  sectionKey: DiscoverySectionKey;
  lastSeenAt: string | null;
  seenByUid: string;
  seenByMemberId: string;
  updatedAt: string;
};

export type DiscoverySectionSummary = {
  sectionKey: DiscoverySectionKey;
  count: number;
  lastSeenAt: string | null;
  label: string;
  children?: Record<string, DiscoverySectionSummary>;
};

export type DiscoverySummary = {
  sections: Record<string, DiscoverySectionSummary>;
  // Convenience aggregate of every top-level count (children already roll up
  // into their parent), useful for a single "What's new" indicator.
  totalCount: number;
};

// Context needed to compute a viewer's discovery summary. Resolved server-side
// from the signed-in (active) profile — never trust client-provided identity.
export type DiscoveryViewerContext = {
  // Active profile identity (the switched-child profile when switched).
  uid: string;
  memberId: string;
  email: string;
  viewerRole: ViewerRole;
  familyId: string;
  idToken: string;
  locale: AppLocale;
  // Member identity aliases (uid, memberId, email) used to match chores/items
  // assigned to the active profile.
  aliases: string[];
};

// Display cap: counts above this render as "99+".
export const DISCOVERY_COUNT_DISPLAY_CAP = 99;
// Hard cap to avoid unbounded counting work.
export const DISCOVERY_COUNT_HARD_CAP = 999;
