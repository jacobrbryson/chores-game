import { DEFAULT_LOCALE, normalizeLocale } from "@packages/locales";
import { createApiClient } from "@packages/api-client";
import type { AppLocale } from "@packages/locales";
import { Platform } from "react-native";

const baseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3000/api/v1";
export const appBaseUrl = baseUrl.replace(/\/api\/v1\/?$/, "");

export const apiClient = createApiClient({
  baseUrl,
  getAccessToken: async () => null,
  fetchImpl: (input, init) => fetch(input, { ...init, credentials: "include" }),
});

export async function apiFetch(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(json?.error?.code ?? json?.error ?? `HTTP_${response.status}`));
  }
  return json?.ok ? json.data : json;
}

export type MobileDiscoverySection = {
  sectionKey: string;
  count: number;
  lastSeenAt: string | null;
  label: string;
  children?: Record<string, MobileDiscoverySection>;
};

export type MobileDiscoverySummary = {
  sections: Record<string, MobileDiscoverySection>;
  totalCount: number;
};

// Discovery / What's New summary for the active mobile profile. Fails soft —
// callers should treat a thrown error as "no badges".
export async function fetchDiscoverySummary(
  sections?: string[],
): Promise<MobileDiscoverySummary> {
  const query = sections && sections.length > 0 ? `?sections=${encodeURIComponent(sections.join(","))}` : "";
  const data = (await apiFetch(`/discovery/summary${query}`)) as Partial<MobileDiscoverySummary>;
  return {
    sections: data.sections ?? {},
    totalCount: typeof data.totalCount === "number" ? data.totalCount : 0,
  };
}

export async function markDiscoverySeen(sections: string[]): Promise<void> {
  const unique = Array.from(new Set(sections.filter(Boolean)));
  if (unique.length === 0) {
    return;
  }
  try {
    await apiFetch("/discovery/seen", { method: "POST", body: JSON.stringify({ sections: unique }) });
  } catch {
    // Mark-seen must never block mobile navigation.
  }
}

export function getDiscoverySectionCount(summary: MobileDiscoverySummary, sectionKey: string): number {
  const top = summary.sections[sectionKey];
  if (top) {
    return top.count;
  }
  for (const parent of Object.values(summary.sections)) {
    const child = parent.children?.[sectionKey];
    if (child) {
      return child.count;
    }
  }
  return 0;
}

export type MobileGhostSuggestion = {
  id: string;
  suggestedTitle: string;
  suggestedDescription: string;
  suggestedCoinValue: number;
  source: string;
};

export async function fetchMobileGhostSuggestions(): Promise<{
  suggestions: MobileGhostSuggestion[];
  eligible: boolean;
}> {
  const data = (await apiFetch("/chores/ghost-suggestions")) as {
    suggestions?: MobileGhostSuggestion[];
    eligible?: boolean;
  };
  return {
    suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
    eligible: Boolean(data.eligible),
  };
}

export async function requestMobileGhostSuggestion(suggestionId: string) {
  return apiFetch(`/chores/ghost-suggestions/${encodeURIComponent(suggestionId)}/request`, {
    method: "POST",
    body: "{}",
  });
}

export async function dismissMobileGhostSuggestion(suggestionId: string) {
  return apiFetch(`/chores/ghost-suggestions/${encodeURIComponent(suggestionId)}/dismiss`, {
    method: "POST",
    body: "{}",
  });
}

export async function addMobileGhostSuggestion(
  suggestionId: string,
  body: { assigneeId?: string; assigneeName?: string } = {},
) {
  return apiFetch(`/chores/ghost-suggestions/${encodeURIComponent(suggestionId)}/add`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export type MobileFeedActor = {
  uid: string;
  name: string;
  avatarId: string;
  avatarPhotoUrl: string;
  primaryColor: string;
};

export type MobileFeedItem = {
  id: string;
  type: string;
  title: string;
  message: string;
  actor: MobileFeedActor | null;
  icon: string;
  action: "view_chore" | "view_reward" | null;
  createdAt: string;
  metadata: { choreId?: string; choreTitle?: string };
};

export type MobileFeedPage = {
  items: MobileFeedItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
};

export async function fetchMobileFeed(page = 1, limit = 20): Promise<MobileFeedPage> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  const payload = await apiFetch(`/feed?${params.toString()}`);
  const pagination = payload?.pagination ?? {};
  return {
    items: Array.isArray(payload?.items) ? (payload.items as MobileFeedItem[]) : [],
    pagination: {
      page: typeof pagination.page === "number" ? pagination.page : page,
      pageSize: typeof pagination.pageSize === "number" ? pagination.pageSize : limit,
      total: typeof pagination.total === "number" ? pagination.total : 0,
      totalPages: typeof pagination.totalPages === "number" ? pagination.totalPages : 1,
      hasMore: Boolean(pagination.hasMore),
    },
  };
}

export type MobileStoreSummary = {
  balance: number;
  avatarUrl: string;
};

export type MobileFamilyAwardClaim = {
  id: string;
  rewardDescription: string;
  rewardImageId: string;
  coinCost: number;
  purchasedAt?: string;
};

export type MobileOwnedItem = {
  id: string;
  name: string;
  description: string;
  image: string;
  category: string;
  quantity: number;
};

export type MobileProfileSummary = {
  canManageAwards: boolean;
  member: {
    id: string;
    role: "admin" | "player";
  };
  unclaimedAwards: MobileFamilyAwardClaim[];
  claimedAwards: MobileFamilyAwardClaim[];
  ownedItems: MobileOwnedItem[];
};

export type MobileStoreOption = {
  id: string;
  label: string;
  value: string;
  price?: number;
  itemImage?: string;
  itemDescription?: string;
  itemStackable?: boolean;
  isPurchasable?: boolean;
  isUnlockable?: boolean;
  unlockSource?: "quest" | "store";
  unlockLabel?: string;
  isDefault?: boolean;
  theme?: {
    primary: string;
    secondary: string;
    tertiary: string;
  };
  confetti?: {
    colors: string[];
    shapes: Array<"rect" | "circle" | "streamer">;
  };
};

export type MobileStoreCategory = {
  id: string;
  name: string;
  description: string;
  price: number;
  imagePath: string;
  kind: "color" | "avatar" | "confetti" | "reward" | "quest_item";
  options: MobileStoreOption[];
};

export type MobileStoreState = {
  balance: number;
  ownedOptionIds: string[];
  questItemQuantities: Record<string, number>;
  dashboardPrimaryColor: string;
  themeOptionId: string;
  themePrimaryColor: string;
  themeSecondaryColor: string;
  themeTertiaryColor: string;
  avatarId: string;
  avatarPhotoUrl?: string;
  googlePhotoUrl?: string;
  selectedConfettiOptionId: string;
  viewerRole?: "admin" | "player";
  categories: MobileStoreCategory[];
};

export type MobileCommunityAward = {
  id: string;
  publicTitle: string;
  publicDescription: string;
  publicCoinAmount: number;
  publicImage: string;
  publicImagePath: string;
  publicCategory: string;
  publicTags: string[];
  voteCount: number;
  copyCount: number;
  viewerVote: 1 | null;
};

export type MobileCommunityAwardsState = {
  awards: MobileCommunityAward[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export type MobileFamilyMember = {
  id: string;
  uid?: string;
  name: string;
  email?: string;
  role: "admin" | "player";
  status: "active" | "invited";
  locale?: AppLocale;
  resolvedLocale?: AppLocale;
  dashboardPrimaryColor?: string;
  avatarId?: string;
  avatarPhotoUrl?: string;
  stats?: {
    currentCoins?: number;
  };
};

export type MobileFamilyCategory = {
  id: string;
  name: string;
  color: string;
};

export type MobileFamilyChore = {
  id: string;
  title: string;
  status: string;
  sortOrder?: number;
  assigneeId?: string;
  assigneeIds?: string[];
  assigneeScope?: "single" | "multiple" | "family";
  assigneeName?: string;
  assigneePrimaryColor?: string;
  assigneeAvatarId?: string;
  assigneeAvatarPhotoUrl?: string;
  categories?: Array<{ id: string; name: string; color: string }>;
  categoryIds?: string[];
  coinValue?: number;
  requireApproval?: boolean;
  choreType?: string;
  dueDate?: string;
  details?: string;
  recurrenceType?: string;
  recurrenceInterval?: number;
  recurrenceUnit?: string;
  source?: "manual" | "google_tasks";
  createdAt?: string;
  // Routine linkage: set when this chore is a materialized step of a routine
  // assignment, so lists can badge the row and collapse sibling steps.
  routineAssignmentId?: string;
  routineId?: string;
  routineName?: string;
  routineStepOrder?: number;
  routineStepCount?: number;
};

export type MobileChoreDetail = MobileFamilyChore & {
  assigneeIds?: string[];
  assigneeScope?: "single" | "multiple" | "family";
};

export type MobileFamilySummary = {
  viewerUid: string;
  viewerAssigneeAliases?: string[];
  wsAuthToken?: string;
  noFamily: boolean;
  family: null | { id: string; name: string; defaultLocale?: AppLocale };
  members: MobileFamilyMember[];
  categories?: MobileFamilyCategory[];
  choresToday: MobileFamilyChore[];
  resolvedLocale?: AppLocale;
};

export type MobileQuestChoice = {
  id: string;
  label: string;
  description: string;
  requiredItemId: string;
  requiredItemName: string;
  requiredItemImage: string;
  consumeItem: boolean;
  allowPurchaseIfMissing: boolean;
  purchaseAndUseImmediately: boolean;
  purchasable: boolean;
  canAfford: boolean;
  price: number;
  ownedQuantity: number;
  owned: boolean;
  madeBefore: boolean;
  disabled: boolean;
  actionText: string;
  unavailableText: string;
};

export type MobileQuestNode =
  | {
      type: "story";
      id: string;
      title: string;
      image?: string;
      audio?: string;
      text: string;
      choices: MobileQuestChoice[];
    }
  | {
      type: "ending";
      id: string;
      title: string;
      image?: string;
      audio?: string;
      text: string;
      ending: {
        endingId: string;
        replayHint?: string;
        rewardSummary: string;
        rewards: {
          coins: number;
          items: string[];
          achievements: string[];
        };
      };
    };

export type MobileQuestProgress = {
  status: "not_started" | "in_progress" | "completed";
  endingsReached: string[];
};

export type MobileQuestLibraryEntry = {
  questId: string;
  title: string;
  subtitle?: string;
  author?: string;
  coverImage?: string;
  summary?: string;
  ageRange?: string;
  estimatedMinutes?: number;
  difficulty?: string;
  completionStatus: MobileQuestProgress["status"];
  endingsDiscovered?: number;
  totalEndings?: number;
  actionLabel?: "Start" | "Continue" | "Replay";
  locked?: boolean;
  prizeHighlights?: Array<{ id: string; label: string; image?: string }>;
};

export type MobileQuestState = {
  quest: {
    id: string;
    title: string;
    subtitle: string;
    meta: { totalEndings: number };
  };
  progress: MobileQuestProgress;
  walletBalance: number;
  currentNode: MobileQuestNode | null;
};

export type MobileQuestChoiceResult = {
  progress: MobileQuestProgress;
  walletBalance: number;
  currentNode: MobileQuestNode;
  transaction: {
    spentCoins: number;
    rewardCoins: number;
    rewardItemIds: string[];
    earnedAchievements: string[];
  };
  ending: null | {
    endingId: string;
    isNewEnding: boolean;
    endingsDiscovered: number;
    totalEndings: number;
    replayHint: string;
    rewardSummary: string;
    rewards: {
      coins: number;
      items: string[];
      achievements: string[];
    };
  };
};

export async function fetchMobileStoreSummary(): Promise<MobileStoreSummary> {
  const summary = await apiFetch("/store");

  const avatarPhotoUrl = typeof summary?.avatarPhotoUrl === "string" ? summary.avatarPhotoUrl.trim() : "";
  const avatarId = typeof summary?.avatarId === "string" ? summary.avatarId.trim() : "";
  const googlePhotoUrl = typeof summary?.googlePhotoUrl === "string" ? summary.googlePhotoUrl.trim() : "";

  return {
    balance: typeof summary?.balance === "number" ? Math.max(0, summary.balance) : 0,
    avatarUrl: (avatarId ? `${appBaseUrl}/avatars/default/${encodeURIComponent(avatarId)}` : "") || avatarPhotoUrl || googlePhotoUrl,
  };
}

export async function fetchMobileProfileSummary(): Promise<MobileProfileSummary | null> {
  try {
    const summary = await apiFetch("/me/profile-summary");
    return {
      canManageAwards: summary?.canManageAwards === true,
      member: {
        id: typeof summary?.member?.id === "string" ? summary.member.id : "",
        role: summary?.member?.role === "admin" ? "admin" : "player",
      },
      unclaimedAwards: Array.isArray(summary?.unclaimedAwards) ? summary.unclaimedAwards : [],
      claimedAwards: Array.isArray(summary?.claimedAwards) ? summary.claimedAwards : [],
      ownedItems: Array.isArray(summary?.ownedItems) ? summary.ownedItems : [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "family_not_found" || message === "member_not_found") {
      return null;
    }
    throw error;
  }
}

export async function claimMobileProfileAward(awardId: string) {
  return apiFetch(`/me/awards/${encodeURIComponent(awardId)}/claim`, {
    method: "POST",
    body: "{}",
  });
}

export function toAppAssetUrl(path: string) {
  if (!path) {
    return "";
  }
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  return `${appBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function fetchMobileQuests(): Promise<{
  items: MobileQuestLibraryEntry[];
  hasUnlockedQuestPack: boolean;
}> {
  const payload = await apiFetch("/quests");
  const items = Array.isArray(payload?.items) ? payload.items as MobileQuestLibraryEntry[] : [];
  return {
    items,
    hasUnlockedQuestPack: payload?.meta?.hasUnlockedQuestPack === true,
  };
}

export async function fetchMobileQuestState(questId: string): Promise<MobileQuestState> {
  return apiFetch(`/quests/${encodeURIComponent(questId)}`) as Promise<MobileQuestState>;
}

export async function startMobileQuest(questId: string): Promise<Pick<MobileQuestState, "progress" | "walletBalance" | "currentNode">> {
  return apiFetch(`/quests/${encodeURIComponent(questId)}/start`, { method: "POST" });
}

export async function chooseMobileQuestPath(questId: string, choiceId: string): Promise<MobileQuestChoiceResult> {
  return apiFetch(`/quests/${encodeURIComponent(questId)}/choice`, {
    method: "POST",
    body: JSON.stringify({ choiceId, purchaseIfMissing: true }),
  });
}

export async function replayMobileQuest(questId: string): Promise<{ progress: MobileQuestProgress }> {
  return apiFetch(`/quests/${encodeURIComponent(questId)}/replay`, { method: "POST" });
}

export async function fetchMobileStoreState(): Promise<MobileStoreState> {
  const summary = await apiFetch("/store");

  return {
    balance: typeof summary?.balance === "number" ? Math.max(0, summary.balance) : 0,
    ownedOptionIds: Array.isArray(summary?.ownedOptionIds) ? summary.ownedOptionIds.filter((value: unknown) => typeof value === "string") : [],
    questItemQuantities: typeof summary?.questItemQuantities === "object" && summary?.questItemQuantities
      ? summary.questItemQuantities as Record<string, number>
      : {},
    dashboardPrimaryColor: typeof summary?.dashboardPrimaryColor === "string" ? summary.dashboardPrimaryColor : "",
    themeOptionId: typeof summary?.themeOptionId === "string" ? summary.themeOptionId : "",
    themePrimaryColor: typeof summary?.themePrimaryColor === "string" ? summary.themePrimaryColor : "",
    themeSecondaryColor: typeof summary?.themeSecondaryColor === "string" ? summary.themeSecondaryColor : "",
    themeTertiaryColor: typeof summary?.themeTertiaryColor === "string" ? summary.themeTertiaryColor : "",
    avatarId: typeof summary?.avatarId === "string" ? summary.avatarId : "",
    avatarPhotoUrl: typeof summary?.avatarPhotoUrl === "string" ? summary.avatarPhotoUrl : "",
    googlePhotoUrl: typeof summary?.googlePhotoUrl === "string" ? summary.googlePhotoUrl : "",
    selectedConfettiOptionId: typeof summary?.selectedConfettiOptionId === "string" ? summary.selectedConfettiOptionId : "",
    viewerRole: summary?.viewerRole === "admin" ? "admin" : "player",
    categories: Array.isArray(summary?.categories) ? summary.categories as MobileStoreCategory[] : [],
  };
}

export async function postMobileStoreAction(body: Record<string, unknown>) {
  return apiFetch("/store", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function fetchMobileCommunityAwards(input: {
  page?: number;
  q?: string;
  sort?: "most_popular" | "newest";
} = {}): Promise<MobileCommunityAwardsState> {
  const params = new URLSearchParams();
  params.set("page", String(input.page ?? 1));
  params.set("limit", "6");
  params.set("sort", input.sort ?? "most_popular");
  if (input.q?.trim()) {
    params.set("q", input.q.trim());
  }
  const payload = await apiFetch(`/community/awards?${params.toString()}`);
  return {
    awards: Array.isArray(payload?.items) ? payload.items : [],
    pagination: {
      page: typeof payload?.pagination?.page === "number" ? payload.pagination.page : 1,
      limit: typeof payload?.pagination?.limit === "number" ? payload.pagination.limit : 6,
      total: typeof payload?.pagination?.total === "number" ? payload.pagination.total : 0,
      totalPages: typeof payload?.pagination?.totalPages === "number" ? payload.pagination.totalPages : 1,
    },
  };
}

export async function copyMobileCommunityAward(awardId: string) {
  return apiFetch(`/community/awards/${encodeURIComponent(awardId)}/copy`, {
    method: "POST",
    body: "{}",
  });
}

export async function voteMobileCommunityAward(awardId: string) {
  const response = await fetch(`${appBaseUrl}/api/votes`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ targetType: "community_award", targetId: awardId, value: 1 }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(json?.error ?? `COMMUNITY_AWARD_VOTE_FAILED_${response.status}`));
  }
  return json;
}

export async function fetchMobileFamilySummary(): Promise<MobileFamilySummary> {
  const summary = await apiFetch("/families/current") as MobileFamilySummary;
  return {
    viewerUid: typeof summary.viewerUid === "string" ? summary.viewerUid : "",
    viewerAssigneeAliases: Array.isArray(summary.viewerAssigneeAliases) ? summary.viewerAssigneeAliases : [],
    wsAuthToken: typeof summary.wsAuthToken === "string" ? summary.wsAuthToken : "",
    noFamily: Boolean(summary.noFamily),
    family: summary.family ?? null,
    members: Array.isArray(summary.members) ? summary.members : [],
    categories: Array.isArray(summary.categories) ? summary.categories : [],
    choresToday: Array.isArray(summary.choresToday) ? summary.choresToday : [],
    resolvedLocale: normalizeLocale(summary.resolvedLocale) || DEFAULT_LOCALE,
  };
}

export async function patchMobileProfile(body: Record<string, unknown>) {
  const response = await fetch(`${appBaseUrl}/api/profile`, {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(json?.error ?? `PROFILE_PATCH_FAILED_${response.status}`));
  }
  return json;
}

export async function getMobileNewsletterPreferences() {
  const response = await fetch(`${appBaseUrl}/api/newsletter/preferences`, {
    credentials: "include",
    cache: "no-store",
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(json?.error ?? `NEWSLETTER_PREFERENCES_GET_FAILED_${response.status}`));
  }
  return {
    weeklyFamilyHighlightsEmail: json?.weeklyFamilyHighlightsEmail === true,
  };
}

export async function patchMobileNewsletterPreferences(body: {
  weeklyFamilyHighlightsEmail: boolean;
}) {
  const response = await fetch(`${appBaseUrl}/api/newsletter/preferences`, {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(json?.error ?? `NEWSLETTER_PREFERENCES_PATCH_FAILED_${response.status}`));
  }
  return {
    weeklyFamilyHighlightsEmail: json?.weeklyFamilyHighlightsEmail === true,
  };
}

export async function patchMobileChore(choreId: string, body: Record<string, unknown>) {
  return apiFetch(`/chores/${encodeURIComponent(choreId)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function editMobileChore(choreId: string, body: Record<string, unknown>) {
  return apiFetch(`/chores/${encodeURIComponent(choreId)}/edit`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export type MobileRoutineAssignmentStep = {
  id: string;
  title: string;
  order: number;
  choreId: string;
  coinValue: number;
};

export type MobileRoutineAssignment = {
  id: string;
  routineName: string;
  pillar: string;
  assigneeName: string;
  status: "active" | "completed";
  steps: MobileRoutineAssignmentStep[];
  completedStepIds: string[];
  skippedStepIds: string[];
  completionBonusCoins: number;
  completionBonusXp: number;
  stepXp: number;
};

// Read one routine assignment for the routine progress dialog. Step mutations
// (complete / undo_complete / unskip) go through patchMobileChore on the step's
// choreId, mirroring the web routine dialog.
export async function fetchMobileRoutineAssignment(
  assignmentId: string,
): Promise<MobileRoutineAssignment> {
  const json = (await apiFetch(`/routines/assignments/${encodeURIComponent(assignmentId)}`)) as {
    assignment?: Partial<MobileRoutineAssignment>;
    completionBonusXp?: number;
    stepXp?: number;
  };
  const assignment = json.assignment ?? {};
  return {
    id: typeof assignment.id === "string" ? assignment.id : assignmentId,
    routineName: typeof assignment.routineName === "string" ? assignment.routineName : "",
    pillar: typeof assignment.pillar === "string" ? assignment.pillar : "",
    assigneeName: typeof assignment.assigneeName === "string" ? assignment.assigneeName : "",
    status: assignment.status === "completed" ? "completed" : "active",
    steps: Array.isArray(assignment.steps)
      ? assignment.steps.map((step) => ({
          id: String(step.id ?? ""),
          title: String(step.title ?? ""),
          order: typeof step.order === "number" ? step.order : 0,
          choreId: String(step.choreId ?? ""),
          coinValue: typeof step.coinValue === "number" ? step.coinValue : 0,
        }))
      : [],
    completedStepIds: Array.isArray(assignment.completedStepIds)
      ? assignment.completedStepIds.filter((value): value is string => typeof value === "string")
      : [],
    skippedStepIds: Array.isArray(assignment.skippedStepIds)
      ? assignment.skippedStepIds.filter((value): value is string => typeof value === "string")
      : [],
    completionBonusCoins:
      typeof assignment.completionBonusCoins === "number" ? assignment.completionBonusCoins : 0,
    completionBonusXp: typeof json.completionBonusXp === "number" ? json.completionBonusXp : 0,
    stepXp: typeof json.stepXp === "number" ? json.stepXp : 0,
  };
}

export async function completeMobileChore(choreId: string, body?: Record<string, unknown>) {
  return apiFetch(`/chores/${encodeURIComponent(choreId)}/complete`, {
    method: "POST",
    body: JSON.stringify(body ?? {}),
  });
}

export async function createMobileChore(body: Record<string, unknown>) {
  return apiFetch("/chores", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function fetchMobileChore(choreId: string): Promise<MobileChoreDetail> {
  const json = await apiFetch(`/chores/${encodeURIComponent(choreId)}`);
  const chore = json?.chore ?? {};
  return {
    id: typeof chore.id === "string" ? chore.id : choreId,
    title: typeof chore.title === "string" ? chore.title : "",
    status: typeof chore.status === "string" ? chore.status : "Open",
    sortOrder: typeof chore.sortOrder === "number" ? chore.sortOrder : undefined,
    assigneeId: typeof chore.assigneeId === "string" ? chore.assigneeId : undefined,
    assigneeIds: Array.isArray(chore.assigneeIds) ? chore.assigneeIds.filter((value: unknown) => typeof value === "string") : [],
    assigneeScope:
      chore.assigneeScope === "family" || chore.assigneeScope === "multiple" || chore.assigneeScope === "single"
        ? chore.assigneeScope
        : "single",
    assigneeName: typeof chore.assigneeName === "string" ? chore.assigneeName : undefined,
    assigneePrimaryColor: typeof chore.assigneePrimaryColor === "string" ? chore.assigneePrimaryColor : undefined,
    assigneeAvatarId: typeof chore.assigneeAvatarId === "string" ? chore.assigneeAvatarId : undefined,
    assigneeAvatarPhotoUrl: typeof chore.assigneeAvatarPhotoUrl === "string" ? chore.assigneeAvatarPhotoUrl : undefined,
    categories: Array.isArray(chore.categories) ? chore.categories : [],
    categoryIds: Array.isArray(chore.categoryIds) ? chore.categoryIds.filter((value: unknown) => typeof value === "string") : [],
    coinValue: typeof chore.coinValue === "number" ? chore.coinValue : 0,
    requireApproval: Boolean(chore.requireApproval),
    choreType: typeof chore.choreType === "string" ? chore.choreType : undefined,
    dueDate: typeof chore.dueDate === "string" ? chore.dueDate : "",
    details: typeof chore.details === "string" ? chore.details : "",
    recurrenceType: typeof chore.recurrenceType === "string" ? chore.recurrenceType : undefined,
    recurrenceInterval: typeof chore.recurrenceInterval === "number" ? chore.recurrenceInterval : undefined,
    recurrenceUnit: typeof chore.recurrenceUnit === "string" ? chore.recurrenceUnit : undefined,
    source: chore.source === "google_tasks" ? "google_tasks" : "manual",
    createdAt: typeof chore.createdAt === "string" ? chore.createdAt : undefined,
  };
}

export async function deleteMobileChore(choreId: string) {
  return apiFetch(`/chores/${encodeURIComponent(choreId)}`, {
    method: "DELETE",
  });
}

export async function reorderMobileChores(orderedChoreIds: string[]) {
  const response = await fetch(`${appBaseUrl}/api/chores`, {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "reorder", orderedChoreIds }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(json?.error ?? `reorder_chores_failed_${response.status}`));
  }
  return json;
}

export type SwitchableMember = {
  id: string;
  name: string;
  status: "active" | "invited";
  avatarUrl: string;
  primaryColor: string;
};

// Resolve a family member's avatar to an absolute image URL, preferring a stored
// avatarId (served locally) and falling back to an external photo URL.
export function memberAvatarUrl(member: { avatarId?: string; avatarPhotoUrl?: string }): string {
  const avatarId = member.avatarId?.trim() ?? "";
  if (avatarId) {
    return `${appBaseUrl}/avatars/default/${encodeURIComponent(avatarId)}`;
  }
  return member.avatarPhotoUrl?.trim() ?? "";
}

// Players the signed-in guardian can switch into ("Switch To..."). Mirrors the
// web profile menu: player-role members excluding the viewer themselves.
export async function fetchSwitchableMembers(): Promise<SwitchableMember[]> {
  const summary = await fetchMobileFamilySummary();
  const viewerUid = summary.viewerUid;
  return summary.members
    .filter(
      (member) =>
        member.role === "player" && member.id !== viewerUid && member.uid !== viewerUid,
    )
    .map((member) => ({
      id: member.id,
      name: member.name,
      status: member.status === "active" ? "active" : "invited",
      avatarUrl: memberAvatarUrl(member),
      primaryColor: member.dashboardPrimaryColor ?? "",
    }));
}

// Switch the current session into a child profile. Throws with the upstream
// error code as the message (e.g. "pin_not_configured", "invalid_pin").
export async function startAccountSwitch(memberId: string, pin: string) {
  return apiFetch("/account-switch/start", {
    method: "POST",
    body: JSON.stringify({ memberId, pin }),
  });
}

// Restore the original signed-in (guardian) account.
export async function stopAccountSwitch(pin: string) {
  return apiFetch("/account-switch/stop", {
    method: "POST",
    body: JSON.stringify({ pin }),
  });
}

// First-time guardian PIN setup, required before the initial account switch.
export async function setupAccountSwitchPin(pin: string, confirmPin: string) {
  return apiFetch("/account-switch/pin", {
    method: "POST",
    body: JSON.stringify({ pin, confirmPin }),
  });
}

export type KioskStatus = {
  active: boolean;
  inFamily: boolean;
  pinRequired: boolean;
  playerIds: string[];
  authenticatedName: string;
};

// Kiosk Mode availability/status probe. Mirrors the web profile menu: decides
// whether to offer the "Kiosk Mode" tab and whether a PIN is required.
export async function fetchKioskStatus(): Promise<KioskStatus> {
  const data = (await apiFetch("/kiosk")) as Partial<KioskStatus>;
  return {
    active: Boolean(data.active),
    inFamily: Boolean(data.inFamily),
    pinRequired: Boolean(data.pinRequired),
    playerIds: Array.isArray(data.playerIds) ? data.playerIds : [],
    authenticatedName: typeof data.authenticatedName === "string" ? data.authenticatedName : "",
  };
}

// Enter Kiosk Mode for the selected roster of players (shared-tablet mode).
export async function startKiosk(playerIds: string[], pin: string) {
  return apiFetch("/kiosk/start", {
    method: "POST",
    body: JSON.stringify({ playerIds, pin }),
  });
}

// Exit Kiosk Mode back to the original signed-in account.
export async function stopKiosk(pin: string) {
  return apiFetch("/kiosk/stop", {
    method: "POST",
    body: JSON.stringify({ pin }),
  });
}

// Switch the active kiosk player within the approved roster (no PIN required).
export async function switchKioskPlayer(playerId: string) {
  return apiFetch("/kiosk/switch", {
    method: "POST",
    body: JSON.stringify({ playerId }),
  });
}

export async function signInWithGoogleIdToken(idToken: string) {
  const response = await fetch(`${appBaseUrl}/api/auth/google/mobile`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json?.ok) {
    throw new Error(String(json?.error ?? "mobile_google_auth_failed"));
  }
  return json.data;
}

export async function signOut() {
  const response = await fetch(`${appBaseUrl}/api/auth/logout`, {
    method: "POST",
    credentials: "include",
    redirect: "manual",
  });
  if (response.status >= 400) {
    throw new Error(`logout_failed_${response.status}`);
  }
  if (Platform.OS !== "web") {
    try {
      const { GoogleSignin } = require("@react-native-google-signin/google-signin");
      await GoogleSignin.signOut();
    } catch (error) {
      console.warn("[MOBILE_GOOGLE_SIGNOUT_WARNING]", error);
    }
  }
}
