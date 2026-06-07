import {
  createOrReplaceDocument,
  documentIdFromName,
  listDocuments,
  readBoolean,
  readString,
  readStringArray,
  readTimestamp,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";
import { ACHIEVEMENT_BY_ID } from "@/lib/achievements/catalog";
import { STORE_CATEGORIES } from "@/lib/store/catalog";
import { listQuestDefinitionsForViewer } from "@/lib/quests/service";
import {
  countNewByTimestamp,
  countNewChangelog,
  countNewChores,
  countNewCompletedAchievements,
  type DiscoveryAchievementRecord,
  type DiscoveryChoreRecord,
} from "@/lib/discovery/counts";
import { getChangeLogEntries } from "@/lib/change-log";
import {
  DISCOVERY_SECTIONS,
  getDiscoverySection,
  getDiscoverySectionFallbackLabel,
  listChildSections,
  listSectionsForRole,
} from "@/lib/discovery/sections";
import { canViewerMarkSectionSeen, canViewerSeeSection } from "@/lib/discovery/visibility";
import type {
  DiscoverySectionKey,
  DiscoverySectionSummary,
  DiscoverySummary,
  DiscoveryViewerContext,
} from "@/lib/discovery/types";

// Firestore document ids cannot be path-friendly with ":" without ambiguity, so
// the nested store section keys are encoded with "__" for the doc id while the
// canonical key is stored in the `sectionKey` field.
function sectionKeyToDocId(sectionKey: DiscoverySectionKey): string {
  return sectionKey.replace(/:/g, "__");
}

function discoveryStatePath(profileUid: string): string {
  return `users/${profileUid}/discoveryState`;
}

// ---------------------------------------------------------------------------
// Last-seen state
// ---------------------------------------------------------------------------

export async function getLastSeenMapForViewer(
  context: Pick<DiscoveryViewerContext, "uid" | "idToken">,
): Promise<Map<DiscoverySectionKey, string | null>> {
  const map = new Map<DiscoverySectionKey, string | null>();
  let docs: Awaited<ReturnType<typeof listDocuments>> = [];
  try {
    docs = await listDocuments(discoveryStatePath(context.uid), context.idToken, 50);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (!reason.includes("FIRESTORE_HTTP_404")) {
      throw error;
    }
  }
  for (const doc of docs) {
    const sectionKey = (readString(doc.fields, "sectionKey") ||
      documentIdFromName(doc.name).replace(/__/g, ":")) as DiscoverySectionKey;
    const lastSeenAt = readTimestamp(doc.fields, "lastSeenAt") || null;
    map.set(sectionKey, lastSeenAt);
  }
  return map;
}

export async function markDiscoverySectionSeen(
  context: DiscoveryViewerContext,
  sectionKey: DiscoverySectionKey,
  seenAt: string = new Date().toISOString(),
): Promise<void> {
  if (!canViewerMarkSectionSeen(sectionKey, context.viewerRole)) {
    throw new Error(`DISCOVERY_SECTION_FORBIDDEN_${sectionKey}`);
  }
  // Validate the section exists (throws on unknown).
  getDiscoverySection(sectionKey);
  await createOrReplaceDocument(
    `${discoveryStatePath(context.uid)}/${sectionKeyToDocId(sectionKey)}`,
    {
      sectionKey: stringField(sectionKey),
      lastSeenAt: timestampField(seenAt),
      seenByUid: stringField(context.uid),
      seenByMemberId: stringField(context.memberId || context.uid),
      updatedAt: timestampField(seenAt),
    },
    context.idToken,
  );
}

export async function markManyDiscoverySectionsSeen(
  context: DiscoveryViewerContext,
  sectionKeys: DiscoverySectionKey[],
): Promise<void> {
  const seenAt = new Date().toISOString();
  // Sequential writes keep the per-document rule validation simple; the set of
  // sections marked at once is small (<= number of registered sections).
  for (const sectionKey of sectionKeys) {
    await markDiscoverySectionSeen(context, sectionKey, seenAt);
  }
}

// ---------------------------------------------------------------------------
// Data sources (loaded lazily based on which sections are requested)
// ---------------------------------------------------------------------------

async function loadChores(
  context: DiscoveryViewerContext,
): Promise<DiscoveryChoreRecord[]> {
  const docs = await listDocuments(
    `families/${context.familyId}/chores`,
    context.idToken,
    300,
  );
  return docs.map((doc) => ({
    createdAt: readTimestamp(doc.fields, "createdAt"),
    status: readString(doc.fields, "status"),
    deleted: readBoolean(doc.fields, "deleted"),
    assigneeId: readString(doc.fields, "assigneeId"),
    assigneeIds: readStringArray(doc.fields, "assigneeIds"),
    assigneeScope: readString(doc.fields, "assigneeScope") || undefined,
  }));
}

async function loadRewardTimestamps(
  context: DiscoveryViewerContext,
): Promise<string[]> {
  const docs = await listDocuments(
    `families/${context.familyId}/rewards`,
    context.idToken,
    200,
  );
  return docs
    .filter((doc) => !readBoolean(doc.fields, "deleted") && !readBoolean(doc.fields, "disabled"))
    .map((doc) => readTimestamp(doc.fields, "createdAt"))
    .filter((value) => value.length > 0);
}

async function loadAchievements(
  context: DiscoveryViewerContext,
): Promise<DiscoveryAchievementRecord[]> {
  const docs = await listDocuments(
    `users/${context.uid}/achievements`,
    context.idToken,
    200,
  );
  const records: DiscoveryAchievementRecord[] = [];
  for (const doc of docs) {
    const achievementId = documentIdFromName(doc.name);
    const catalogEntry = ACHIEVEMENT_BY_ID.get(achievementId);
    if (!catalogEntry) {
      continue;
    }
    records.push({
      audience: catalogEntry.audience,
      completed: readBoolean(doc.fields, "completed"),
      completedAt: readString(doc.fields, "completedAt") || undefined,
    });
  }
  return records;
}

async function loadQuestPublishTimestamps(
  context: DiscoveryViewerContext,
): Promise<string[]> {
  const quests = await listQuestDefinitionsForViewer({
    uid: context.uid,
    email: context.email,
    idToken: context.idToken,
    locale: context.locale,
  });
  return quests
    .map((quest) => quest.publishedAt)
    .filter((value): value is string => Boolean(value));
}

// Per-store-category item timestamps (catalog `addedAt`, plus dynamic family
// rewards `createdAt`). Returns a map keyed by store category id.
function storeCatalogTimestampsByCategory(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const category of STORE_CATEGORIES) {
    map.set(
      category.id,
      category.options
        .map((option) => option.addedAt)
        .filter((value): value is string => Boolean(value)),
    );
  }
  return map;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

type SectionNeeds = {
  chores: boolean;
  store: boolean;
  quests: boolean;
  achievements: boolean;
  changelog: boolean;
  communityAwards: boolean;
};

function resolveNeeds(sectionKeys: DiscoverySectionKey[]): SectionNeeds {
  const set = new Set(sectionKeys);
  const anyStore = Array.from(set).some(
    (key) => key === "store" || key.startsWith("store:"),
  );
  return {
    chores: set.has("chores"),
    store: anyStore,
    quests: set.has("quests"),
    achievements: set.has("achievements"),
    changelog: set.has("changelog"),
    communityAwards: set.has("community_awards"),
  };
}

export async function getDiscoverySummaryForViewer(
  context: DiscoveryViewerContext,
  options?: { sections?: DiscoverySectionKey[] },
): Promise<DiscoverySummary> {
  // Resolve which sections this viewer's role may see, optionally narrowed by
  // an explicit request.
  const roleSections = listSectionsForRole(context.viewerRole).map((s) => s.key);
  const requested = options?.sections
    ? options.sections.filter((key) => canViewerSeeSection(key, context.viewerRole))
    : roleSections;
  const requestedSet = new Set(requested);
  // Requesting a nested (store category) section implies its top-level parent so
  // the parent emits and nests the requested child.
  for (const key of requested) {
    const parentKey = getDiscoverySection(key).parentKey;
    if (parentKey) {
      requestedSet.add(parentKey);
    }
  }

  // No family → empty summary (fail soft, not an error).
  if (!context.familyId) {
    return { sections: {}, totalCount: 0 };
  }

  const lastSeen = await getLastSeenMapForViewer(context);
  const needs = resolveNeeds(requested);

  const [chores, rewardTimestamps, achievements, questTimestamps] = await Promise.all([
    needs.chores ? loadChores(context) : Promise.resolve([] as DiscoveryChoreRecord[]),
    needs.store ? loadRewardTimestamps(context) : Promise.resolve([] as string[]),
    needs.achievements ? loadAchievements(context) : Promise.resolve([] as DiscoveryAchievementRecord[]),
    needs.quests ? loadQuestPublishTimestamps(context) : Promise.resolve([] as string[]),
  ]);

  const storeTimestamps = needs.store ? storeCatalogTimestampsByCategory() : new Map<string, string[]>();
  storeTimestamps.set("family_awards", rewardTimestamps);

  const changelogDates = needs.changelog ? getChangeLogEntries().map((entry) => entry.date) : [];

  function computeLeafCount(
    sectionKey: DiscoverySectionKey,
    lastSeenAt: string | null,
  ): number {
    switch (sectionKey) {
      case "chores":
        return countNewChores({
          chores,
          viewerRole: context.viewerRole,
          aliases: context.aliases,
          lastSeenAt,
        });
      case "quests":
        return countNewByTimestamp(questTimestamps, lastSeenAt);
      case "achievements":
        return countNewCompletedAchievements({
          achievements,
          viewerRole: context.viewerRole,
          lastSeenAt,
        });
      case "changelog":
        return countNewChangelog({ entryDates: changelogDates, lastSeenAt });
      case "community_awards":
        // TODO: approved public community awards expose only curated fields via
        // server-side admin credentials / curated bucket JSON. Counting needs a
        // public published timestamp source; returns 0 until that is wired up.
        return 0;
      case "store":
        // Top-level store badge = all visible store items added after the store
        // section was last seen (across every visible category).
        return countNewByTimestamp(
          Array.from(storeTimestamps.values()).flat(),
          lastSeenAt,
        );
      default: {
        // Store category leaf.
        const section = getDiscoverySection(sectionKey);
        const categoryId = section.storeCategoryId ?? "";
        return countNewByTimestamp(storeTimestamps.get(categoryId) ?? [], lastSeenAt);
      }
    }
  }

  const sections: Record<string, DiscoverySectionSummary> = {};
  let totalCount = 0;

  for (const definition of DISCOVERY_SECTIONS) {
    // Only emit top-level sections at the root; children are nested under their
    // parent below.
    if (definition.parentKey) {
      continue;
    }
    if (!requestedSet.has(definition.key)) {
      continue;
    }
    const lastSeenAt = lastSeen.get(definition.key) ?? null;
    const summary: DiscoverySectionSummary = {
      sectionKey: definition.key,
      count: computeLeafCount(definition.key, lastSeenAt),
      lastSeenAt,
      label: getDiscoverySectionFallbackLabel(definition.key),
    };

    const children = listChildSections(definition.key).filter((child) =>
      canViewerSeeSection(child.key, context.viewerRole),
    );
    if (children.length > 0) {
      summary.children = {};
      for (const child of children) {
        const childLastSeen = lastSeen.get(child.key) ?? null;
        summary.children[child.key] = {
          sectionKey: child.key,
          count: computeLeafCount(child.key, childLastSeen),
          lastSeenAt: childLastSeen,
          label: getDiscoverySectionFallbackLabel(child.key),
        };
      }
    }

    sections[definition.key] = summary;
    totalCount += summary.count;
  }

  return { sections, totalCount };
}

export async function getDiscoveryCountForSection(
  context: DiscoveryViewerContext,
  sectionKey: DiscoverySectionKey,
): Promise<number> {
  if (!canViewerSeeSection(sectionKey, context.viewerRole)) {
    return 0;
  }
  const summary = await getDiscoverySummaryForViewer(context, {
    sections: [sectionKey],
  });
  const topLevel = summary.sections[sectionKey];
  if (topLevel) {
    return topLevel.count;
  }
  for (const parent of Object.values(summary.sections)) {
    const child = parent.children?.[sectionKey];
    if (child) {
      return child.count;
    }
  }
  return 0;
}
