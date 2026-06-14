import rawChangeLogEntries from "@/data/change-log.json";

export const CHANGE_LOG_ENTRY_TYPES = ["Feature", "Bug Fix"] as const;
export type ChangeLogEntryType = (typeof CHANGE_LOG_ENTRY_TYPES)[number];

export type ChangeLogEntry = {
  id: string;
  date: string;
  type: ChangeLogEntryType;
  subject: string;
  description: string;
  image: string;
  imageType?: "hero";
};

export type ChangeLogEntryGroup = {
  date: string;
  slug: string;
  startDate: string;
  endDate: string;
  entries: ChangeLogEntry[];
  features: ChangeLogEntry[];
  bugFixes: ChangeLogEntry[];
};

type ChangeLogDateRange = {
  slug: string;
  startDate: string;
  endDate: string;
};

const CHANGE_LOG_DATE_RANGES: ChangeLogDateRange[] = [
  {
    slug: "2026-06-14",
    startDate: "2026-06-11",
    endDate: "2026-06-14",
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isChangeLogEntryType(value: unknown): value is ChangeLogEntryType {
  return typeof value === "string" && CHANGE_LOG_ENTRY_TYPES.includes(value as ChangeLogEntryType);
}

function assertNonEmptyString(value: unknown, field: string, index: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`CHANGE_LOG_ENTRY_${index}_${field.toUpperCase()}_REQUIRED`);
  }
  return value.trim();
}

function assertDate(value: unknown, index: number) {
  const date = assertNonEmptyString(value, "date", index);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new Error(`CHANGE_LOG_ENTRY_${index}_DATE_INVALID`);
  }
  return date;
}

function assertType(value: unknown, index: number): ChangeLogEntryType {
  if (!isChangeLogEntryType(value)) {
    throw new Error(`CHANGE_LOG_ENTRY_${index}_TYPE_INVALID`);
  }
  return value;
}

function validateChangeLogEntries(source: unknown): ChangeLogEntry[] {
  if (!Array.isArray(source)) {
    throw new Error("CHANGE_LOG_ENTRIES_INVALID");
  }

  return source
    .map((item, index) => {
      if (!isRecord(item)) {
        throw new Error(`CHANGE_LOG_ENTRY_${index}_INVALID`);
      }

      return {
        id: assertNonEmptyString(item.id, "id", index),
        date: assertDate(item.date, index),
        type: assertType(item.type, index),
        subject: assertNonEmptyString(item.subject, "subject", index),
        description: assertNonEmptyString(item.description, "description", index),
        image: assertNonEmptyString(item.image, "image", index),
        ...(item.imageType === "hero" && { imageType: "hero" as const }),
      } satisfies ChangeLogEntry;
    })
    .sort((left, right) => right.date.localeCompare(left.date));
}

export function getChangeLogEntries(): ChangeLogEntry[] {
  return validateChangeLogEntries(rawChangeLogEntries);
}

function toChangeLogEntryGroup(
  date: string,
  entries: ChangeLogEntry[],
  range?: ChangeLogDateRange,
): ChangeLogEntryGroup {
  return {
    date,
    slug: range?.slug ?? date,
    startDate: range?.startDate ?? date,
    endDate: range?.endDate ?? date,
    entries,
    features: entries.filter((entry) => entry.type === "Feature"),
    bugFixes: entries.filter((entry) => entry.type === "Bug Fix"),
  };
}

function isEntryInRange(entry: ChangeLogEntry, range: ChangeLogDateRange) {
  return entry.date >= range.startDate && entry.date <= range.endDate;
}

function getRangeForDate(date: string) {
  return CHANGE_LOG_DATE_RANGES.find((range) => date >= range.startDate && date <= range.endDate);
}

export function getChangeLogEntryGroup(slugOrDate: string): ChangeLogEntryGroup | null {
  const range = CHANGE_LOG_DATE_RANGES.find((candidate) => candidate.slug === slugOrDate) ?? getRangeForDate(slugOrDate);
  const entries = getChangeLogEntries().filter((entry) =>
    range ? isEntryInRange(entry, range) : entry.date === slugOrDate,
  );
  if (entries.length === 0) {
    return null;
  }
  return toChangeLogEntryGroup(range?.endDate ?? slugOrDate, entries, range);
}

export function getChangeLogEntryGroups(): ChangeLogEntryGroup[] {
  const groups = new Map<string, ChangeLogEntry[]>();
  for (const entry of getChangeLogEntries()) {
    const range = getRangeForDate(entry.date);
    const key = range?.slug ?? entry.date;
    const current = groups.get(key) ?? [];
    current.push(entry);
    groups.set(key, current);
  }
  return [...groups.entries()]
    .map(([key, entries]) => {
      const range = CHANGE_LOG_DATE_RANGES.find((candidate) => candidate.slug === key);
      return toChangeLogEntryGroup(range?.endDate ?? key, entries, range);
    })
    .sort((left, right) => right.endDate.localeCompare(left.endDate));
}
