import AsyncStorage from "@react-native-async-storage/async-storage";

type DashboardSortKey = "manual" | "coin_value" | "frequency" | "alphabetical";
type DashboardSortDirection = "asc" | "desc";
type ChoreSortBy = "title" | "status" | "assigneeName" | "dueDate" | "completedAt" | "coinValue";
type StatusFilter = "" | "needs_approval" | "completed";

type DashboardChorePreferences = {
  selectedMemberId: string;
  sortKey: DashboardSortKey;
  sortDirection: DashboardSortDirection;
};

type AllChoresPreferences = {
  filtersExpanded: boolean;
  searchQuery: string;
  sortBy: ChoreSortBy;
  sortDir: "asc" | "desc";
  statusFilter: StatusFilter;
};

type AchievementsPreferences = {
  hideComplete: boolean;
};

type ChoreEditorPreferences = {
  additionalOptionsExpanded: boolean;
};

const DASHBOARD_TAB_PREFIX = "mobile:dashboard:tab";
const DASHBOARD_PREFIX = "mobile:dashboard:chores";
const ALL_CHORES_PREFIX = "mobile:chores:list";
const ACHIEVEMENTS_PREFIX = "mobile:achievements";
const CHORE_EDITOR_PREFIX = "mobile:chore:editor";

function dashboardTabKey(viewerKey: string) {
  return `${DASHBOARD_TAB_PREFIX}:${viewerKey || "default"}`;
}

function dashboardKey(viewerKey: string) {
  return `${DASHBOARD_PREFIX}:${viewerKey || "default"}`;
}

function allChoresKey(viewerKey: string) {
  return `${ALL_CHORES_PREFIX}:${viewerKey || "default"}`;
}

function achievementsKey(viewerKey: string) {
  return `${ACHIEVEMENTS_PREFIX}:${viewerKey || "default"}`;
}

function choreEditorKey(viewerKey: string) {
  return `${CHORE_EDITOR_PREFIX}:${viewerKey || "default"}`;
}

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJson(key: string, value: unknown) {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage write failures and keep the in-memory state.
  }
}

function isDashboardSortKey(value: unknown): value is DashboardSortKey {
  return value === "manual" || value === "coin_value" || value === "frequency" || value === "alphabetical";
}

function isDashboardSortDirection(value: unknown): value is DashboardSortDirection {
  return value === "asc" || value === "desc";
}

function isChoreSortBy(value: unknown): value is ChoreSortBy {
  return (
    value === "title" ||
    value === "status" ||
    value === "assigneeName" ||
    value === "dueDate" ||
    value === "completedAt" ||
    value === "coinValue"
  );
}

function isStatusFilter(value: unknown): value is StatusFilter {
  return value === "" || value === "needs_approval" || value === "completed";
}

export type DashboardTab = "feed" | "chores";

function isDashboardTab(value: unknown): value is DashboardTab {
  return value === "feed" || value === "chores";
}

// Chores is the default dashboard tab; selection sticks per signed-in viewer.
export async function loadDashboardTabPreference(viewerKey: string): Promise<DashboardTab> {
  const stored = await readJson<{ tab?: DashboardTab }>(dashboardTabKey(viewerKey));
  return isDashboardTab(stored?.tab) ? stored.tab : "chores";
}

export async function saveDashboardTabPreference(viewerKey: string, tab: DashboardTab) {
  await writeJson(dashboardTabKey(viewerKey), { tab });
}

export async function loadDashboardChorePreferences(viewerKey: string): Promise<DashboardChorePreferences> {
  const stored = await readJson<Partial<DashboardChorePreferences>>(dashboardKey(viewerKey));
  return {
    selectedMemberId: typeof stored?.selectedMemberId === "string" ? stored.selectedMemberId : "",
    sortKey: isDashboardSortKey(stored?.sortKey) ? stored.sortKey : "manual",
    sortDirection: isDashboardSortDirection(stored?.sortDirection) ? stored.sortDirection : "asc",
  };
}

export async function saveDashboardChorePreferences(
  viewerKey: string,
  preferences: DashboardChorePreferences,
) {
  await writeJson(dashboardKey(viewerKey), preferences);
}

export async function loadAllChoresPreferences(viewerKey: string): Promise<AllChoresPreferences> {
  const stored = await readJson<Partial<AllChoresPreferences>>(allChoresKey(viewerKey));
  return {
    filtersExpanded: Boolean(stored?.filtersExpanded),
    searchQuery: typeof stored?.searchQuery === "string" ? stored.searchQuery : "",
    sortBy: isChoreSortBy(stored?.sortBy) ? stored.sortBy : "completedAt",
    sortDir: stored?.sortDir === "asc" ? "asc" : "desc",
    statusFilter: isStatusFilter(stored?.statusFilter) ? stored.statusFilter : "",
  };
}

export async function saveAllChoresPreferences(viewerKey: string, preferences: AllChoresPreferences) {
  await writeJson(allChoresKey(viewerKey), preferences);
}

export async function loadAchievementsPreferences(viewerKey: string): Promise<AchievementsPreferences> {
  const stored = await readJson<Partial<AchievementsPreferences>>(achievementsKey(viewerKey));
  return {
    hideComplete: Boolean(stored?.hideComplete),
  };
}

export async function saveAchievementsPreferences(viewerKey: string, preferences: AchievementsPreferences) {
  await writeJson(achievementsKey(viewerKey), preferences);
}

export async function loadChoreEditorPreferences(viewerKey: string): Promise<ChoreEditorPreferences> {
  const stored = await readJson<Partial<ChoreEditorPreferences>>(choreEditorKey(viewerKey));
  return {
    additionalOptionsExpanded: Boolean(stored?.additionalOptionsExpanded),
  };
}

export async function saveChoreEditorPreferences(viewerKey: string, preferences: ChoreEditorPreferences) {
  await writeJson(choreEditorKey(viewerKey), preferences);
}
