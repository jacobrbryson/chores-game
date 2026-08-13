import type { FamilyCategory } from "@/lib/family/types";

// Shared stale-while-revalidate cache for the family-summary data that assignee
// pickers depend on (members + categories + viewer uid).
//
// Why this exists: the chore dialog and the routine assign dialog both need the
// member list before their assignee selects can render anything, and
// /api/family/summary can take seconds on a cold call. Previously each dialog
// owned its own cache, so the list was refetched from scratch on every page
// load and the select sat empty with no feedback while it waited.
//
// Every surface that already fetches the summary (dashboard, kiosk entry,
// profile menu) warms this cache via writeFamilySummaryCache, so by the time a
// dialog opens the options are usually already present and the select paints
// instantly. Dialogs still revalidate in the background — the cache decides what
// paints first, never what is ultimately correct.
//
// Deliberately memory-only. Member names are CHILD_SENSITIVE per AGENTS.md, and
// persisting them to localStorage would leave child data at rest in the browser
// on shared family devices — which Kiosk Mode explicitly targets. The warming
// strategy above gets the same perceived speed without that tradeoff.

export type CachedFamilyMember = {
  id: string;
  uid?: string;
  name: string;
  role: "admin" | "player";
};

export type FamilySummaryCacheEntry = {
  members: CachedFamilyMember[];
  categories: FamilyCategory[];
  viewerUid: string;
  cachedAt: number;
};

// Entries older than this are dropped rather than shown. Family membership
// changes rarely, so this is generous on purpose: a stale list that is about to
// be revalidated is a much better first paint than an empty select.
const FAMILY_SUMMARY_CACHE_TTL_MS = 30 * 60 * 1_000;

let familySummaryCache: FamilySummaryCacheEntry | null = null;

export function readFamilySummaryCache(): FamilySummaryCacheEntry | null {
  if (!familySummaryCache) {
    return null;
  }
  if (Date.now() - familySummaryCache.cachedAt > FAMILY_SUMMARY_CACHE_TTL_MS) {
    familySummaryCache = null;
    return null;
  }
  return familySummaryCache;
}

export function writeFamilySummaryCache(input: {
  members: CachedFamilyMember[];
  categories: FamilyCategory[];
  viewerUid: string;
}) {
  familySummaryCache = {
    members: input.members,
    categories: input.categories,
    viewerUid: input.viewerUid,
    cachedAt: Date.now(),
  };
}

// Called on sign-out / profile switch so one family's member list can never be
// shown to the next session in the same tab.
export function clearFamilySummaryCache() {
  familySummaryCache = null;
}
