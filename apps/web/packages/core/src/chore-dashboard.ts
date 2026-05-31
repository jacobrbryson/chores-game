export type DashboardSortKey = "manual" | "coin_value" | "frequency" | "alphabetical";
export type DashboardSortDirection = "asc" | "desc";

export type DashboardChoreLike = {
  id: string;
  title: string;
  status?: string;
  coinValue?: number;
  sortOrder?: number;
  createdAt?: string;
};

export function normalizeDashboardChoreTitle(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function toUnixMillis(value?: string) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function compareDashboardChoresByManualOrder<T extends DashboardChoreLike>(a: T, b: T) {
  const aHasSortOrder = typeof a.sortOrder === "number";
  const bHasSortOrder = typeof b.sortOrder === "number";
  if (aHasSortOrder && bHasSortOrder && a.sortOrder !== b.sortOrder) {
    return (a.sortOrder as number) - (b.sortOrder as number);
  }
  if (aHasSortOrder && !bHasSortOrder) return -1;
  if (!aHasSortOrder && bHasSortOrder) return 1;
  const createdDiff = toUnixMillis(a.createdAt) - toUnixMillis(b.createdAt);
  return createdDiff || a.id.localeCompare(b.id);
}

export function sortDashboardChores<T extends DashboardChoreLike>(
  chores: T[],
  sortKey: DashboardSortKey = "manual",
  direction: DashboardSortDirection = "asc",
) {
  const manualSorted = [...chores].sort(compareDashboardChoresByManualOrder);
  if (sortKey === "manual") {
    return manualSorted;
  }

  const indexById = new Map(manualSorted.map((chore, index) => [chore.id, index]));
  const frequencyByTitle = new Map<string, number>();
  for (const chore of manualSorted) {
    const title = normalizeDashboardChoreTitle(chore.title);
    frequencyByTitle.set(title, (frequencyByTitle.get(title) ?? 0) + 1);
  }
  const multiplier = direction === "desc" ? -1 : 1;

  return [...manualSorted].sort((a, b) => {
    let comparison = 0;
    if (sortKey === "coin_value") {
      comparison = (a.coinValue ?? 0) - (b.coinValue ?? 0);
    } else if (sortKey === "frequency") {
      comparison =
        (frequencyByTitle.get(normalizeDashboardChoreTitle(a.title)) ?? 0) -
        (frequencyByTitle.get(normalizeDashboardChoreTitle(b.title)) ?? 0);
    } else {
      comparison = a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    }
    return comparison ? comparison * multiplier : (indexById.get(a.id) ?? 0) - (indexById.get(b.id) ?? 0);
  });
}

export function getDashboardChorePage<T>(items: T[], visibleCount: number) {
  const count = Math.max(0, Math.trunc(visibleCount));
  return {
    visibleItems: items.slice(0, count),
    hasMore: items.length > count,
    remainingCount: Math.max(0, items.length - count),
  };
}
