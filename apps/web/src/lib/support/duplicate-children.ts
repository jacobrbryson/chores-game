// Pure helpers for the support "duplicate children" detection report. Kept free
// of Firestore I/O so the grouping + safety rules can be unit-tested. The route
// (api/support/duplicate-children) supplies the raw records and activity counts.

export type ChildActivity = {
  choreCount: number;
  completedChoreCount: number;
  coinBalance: number;
  walletEntryCount: number;
  inventoryCount: number;
  achievementCount: number;
};

export type ChildRecord = {
  familyId: string;
  memberId: string;
  name: string;
  role: string;
  deleted: boolean;
  createdAt: string;
  /** Family parental-consent timestamp, used for the "created after TOS" signal. */
  familyConsentAt?: string | null;
  /** Optional activity counts; when omitted, treated as unknown (not safe to delete). */
  activity?: ChildActivity;
};

export type DuplicateChildCandidate = ChildRecord & {
  /** True for the earliest-created record in the group (the one to keep). */
  isOriginal: boolean;
  hasMeaningfulActivity: boolean;
  safeToDelete: boolean;
  createdAfterFamilyConsent: boolean;
};

export type DuplicateChildGroup = {
  familyId: string;
  normalizedName: string;
  displayName: string;
  candidates: DuplicateChildCandidate[];
};

const EMPTY_ACTIVITY: ChildActivity = {
  choreCount: 0,
  completedChoreCount: 0,
  coinBalance: 0,
  walletEntryCount: 0,
  inventoryCount: 0,
  achievementCount: 0,
};

// Normalize a display name for similarity grouping: trim, collapse internal
// whitespace, and lowercase. This catches "Sam" vs "sam " vs "Sam " duplicates
// produced by re-running onboarding.
export function normalizeChildName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

// A child has meaningful activity if anything is linked that we cannot safely
// discard without a merge/reassignment path: chores, completions, coins, wallet
// history, inventory, or achievements. Unknown activity (undefined) is treated
// as meaningful so we never soft-delete something we failed to inspect.
export function hasMeaningfulActivity(activity: ChildActivity | undefined): boolean {
  if (!activity) {
    return true;
  }
  return (
    activity.choreCount > 0 ||
    activity.completedChoreCount > 0 ||
    activity.coinBalance > 0 ||
    activity.walletEntryCount > 0 ||
    activity.inventoryCount > 0 ||
    activity.achievementCount > 0
  );
}

function toMillis(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

// Group active player records by (familyId + normalized name) and return only
// groups with 2+ records — the possible duplicates. Within each group the
// earliest-created record is flagged as the original; the rest are deletion
// candidates, each annotated with whether it is safe to soft-delete.
export function findDuplicateChildGroups(children: ChildRecord[]): DuplicateChildGroup[] {
  const groups = new Map<string, ChildRecord[]>();

  for (const child of children) {
    if (child.role !== "player" || child.deleted) {
      continue;
    }
    const normalizedName = normalizeChildName(child.name);
    if (!normalizedName) {
      continue;
    }
    const key = `${child.familyId}::${normalizedName}`;
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(child);
    } else {
      groups.set(key, [child]);
    }
  }

  const result: DuplicateChildGroup[] = [];

  for (const [key, bucket] of groups) {
    if (bucket.length < 2) {
      continue;
    }
    const sorted = [...bucket].sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
    const earliestMillis = toMillis(sorted[0].createdAt);

    const candidates: DuplicateChildCandidate[] = sorted.map((child) => {
      const isOriginal = toMillis(child.createdAt) === earliestMillis;
      const meaningful = hasMeaningfulActivity(child.activity ?? undefined);
      const createdAfterFamilyConsent = Boolean(
        child.familyConsentAt && toMillis(child.createdAt) >= toMillis(child.familyConsentAt),
      );
      return {
        ...child,
        activity: child.activity ?? { ...EMPTY_ACTIVITY },
        isOriginal,
        hasMeaningfulActivity: meaningful,
        // Only non-original, empty duplicates are ever safe to soft-delete.
        safeToDelete: !isOriginal && !meaningful,
        createdAfterFamilyConsent,
      };
    });

    const [familyId] = key.split("::");
    result.push({
      familyId,
      normalizedName: normalizeChildName(sorted[0].name),
      displayName: sorted[0].name.trim(),
      candidates,
    });
  }

  // Most recently-created groups first so support sees fresh damage at the top.
  result.sort((a, b) => {
    const aLatest = Math.max(...a.candidates.map((c) => toMillis(c.createdAt)).filter(Number.isFinite));
    const bLatest = Math.max(...b.candidates.map((c) => toMillis(c.createdAt)).filter(Number.isFinite));
    return bLatest - aLatest;
  });

  return result;
}
