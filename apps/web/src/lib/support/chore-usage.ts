// Chore usage aggregation for the Support Console Chores page.
//
// This collapses the raw per-family chore documents into a catalog-style view:
// how many chores exist in total, how many distinct chores there are, and how
// often each one is used across families. It is the first step toward a shared
// canonical chore catalog (e.g. treating "Clean Room" and "clean your room" as
// one entry). Full semantic aliasing needs a curated catalog and is out of
// scope here — `normalizeChoreTitleKey` does light structural normalization
// (case, punctuation, articles/possessives) so obvious variants merge without
// risking false matches between genuinely different chores.
//
// Two distinct concepts that are easy to conflate:
// - "recurring" chores repeat on a schedule (chore.recurrenceType != none).
// - "routines" are parent-defined templates (families/{id}/routines) — an
//   ordered list of step titles that map to chores by title. A chore's routine
//   count is how many routine templates reference it, computed from the routine
//   step titles (see buildRoutineCountByKey), NOT from the chore's recurrence.

// Conservative stop words: articles and possessives that almost never change a
// chore's identity. Deliberately excludes verbs/nouns so distinct chores stay
// distinct.
const TITLE_STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "your",
  "my",
  "our",
  "their",
  "his",
  "her",
  "please",
]);

export function normalizeChoreTitleKey(title: string): string {
  const cleaned = (title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) {
    return "";
  }
  const tokens = cleaned.split(" ").filter((token) => !TITLE_STOP_WORDS.has(token));
  // If a title is nothing but stop words/punctuation, keep the cleaned form so
  // it still groups with identical titles instead of collapsing to "".
  return tokens.length ? tokens.join(" ") : cleaned;
}

function isRecurring(recurrenceType: string | undefined): boolean {
  return Boolean(recurrenceType) && recurrenceType !== "none";
}

export type ChoreUsageInput = {
  title: string;
  familyId: string;
  recurrenceType?: string;
};

/** A routine template and the titles of the steps it contains. */
export type RoutineStepsInput = {
  /** Globally-unique routine identity (e.g. its Firestore document name). */
  routineId: string;
  stepTitles: string[];
};

// Maps each normalized chore key to the number of distinct routine templates
// that include a step with that title. A routine that lists the same chore
// twice still counts once.
export function buildRoutineCountByKey(routines: RoutineStepsInput[]): Map<string, number> {
  const routineIdsByKey = new Map<string, Set<string>>();
  for (const routine of routines) {
    const keysInRoutine = new Set<string>();
    for (const title of routine.stepTitles) {
      const key = normalizeChoreTitleKey(title);
      if (key) {
        keysInRoutine.add(key);
      }
    }
    for (const key of keysInRoutine) {
      let ids = routineIdsByKey.get(key);
      if (!ids) {
        ids = new Set();
        routineIdsByKey.set(key, ids);
      }
      ids.add(routine.routineId);
    }
  }
  const counts = new Map<string, number>();
  for (const [key, ids] of routineIdsByKey) {
    counts.set(key, ids.size);
  }
  return counts;
}

export type ChoreUsageRow = {
  /** Normalized grouping key. */
  key: string;
  /** Most common original title for this key, for display. */
  title: string;
  /** Total chore documents that map to this key. */
  count: number;
  /** Distinct families that use a chore mapping to this key. */
  familyCount: number;
  /** Distinct routine templates that include this chore as a step. */
  routineCount: number;
};

export type ChoreUsageSummary = {
  /** Total chore documents scanned. */
  totalChores: number;
  /** Distinct normalized chore titles. */
  uniqueChores: number;
  /** Chore documents that repeat on a schedule (recurrenceType != none). */
  recurringChores: number;
  /** Distinct families that have at least one chore. */
  familyCount: number;
  /** Usage rows sorted most-used first. */
  usage: ChoreUsageRow[];
};

type Accumulator = {
  key: string;
  count: number;
  families: Set<string>;
  titleCounts: Map<string, number>;
};

function pickDisplayTitle(titleCounts: Map<string, number>): string {
  let best = "";
  let bestCount = -1;
  for (const [title, count] of titleCounts) {
    // Prefer the most frequent original title; break ties alphabetically for
    // deterministic output.
    if (count > bestCount || (count === bestCount && title < best)) {
      best = title;
      bestCount = count;
    }
  }
  return best;
}

export function aggregateChoreUsage(
  inputs: ChoreUsageInput[],
  options?: { topN?: number; routineCountByKey?: Map<string, number> },
): ChoreUsageSummary {
  const byKey = new Map<string, Accumulator>();
  const allFamilies = new Set<string>();
  let totalChores = 0;
  let recurringChores = 0;

  for (const input of inputs) {
    totalChores += 1;
    if (isRecurring(input.recurrenceType)) {
      recurringChores += 1;
    }
    if (input.familyId) {
      allFamilies.add(input.familyId);
    }

    const key = normalizeChoreTitleKey(input.title);
    let acc = byKey.get(key);
    if (!acc) {
      acc = { key, count: 0, families: new Set(), titleCounts: new Map() };
      byKey.set(key, acc);
    }
    acc.count += 1;
    if (input.familyId) {
      acc.families.add(input.familyId);
    }
    const displayTitle = (input.title ?? "").trim() || "Untitled chore";
    acc.titleCounts.set(displayTitle, (acc.titleCounts.get(displayTitle) ?? 0) + 1);
  }

  const routineCountByKey = options?.routineCountByKey;
  let usage: ChoreUsageRow[] = [...byKey.values()]
    .map((acc) => ({
      key: acc.key,
      title: pickDisplayTitle(acc.titleCounts),
      count: acc.count,
      familyCount: acc.families.size,
      routineCount: routineCountByKey?.get(acc.key) ?? 0,
    }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (b.familyCount !== a.familyCount) return b.familyCount - a.familyCount;
      return a.title.localeCompare(b.title);
    });

  if (options?.topN && options.topN > 0) {
    usage = usage.slice(0, options.topN);
  }

  return {
    totalChores,
    uniqueChores: byKey.size,
    recurringChores,
    familyCount: allFamilies.size,
    usage,
  };
}
