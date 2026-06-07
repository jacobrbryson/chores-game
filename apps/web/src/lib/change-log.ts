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
  entries: ChangeLogEntry[];
  features: ChangeLogEntry[];
  bugFixes: ChangeLogEntry[];
};

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

export function getChangeLogEntryGroup(date: string): ChangeLogEntryGroup | null {
  const entries = getChangeLogEntries().filter((entry) => entry.date === date);
  if (entries.length === 0) {
    return null;
  }
  return {
    date,
    entries,
    features: entries.filter((entry) => entry.type === "Feature"),
    bugFixes: entries.filter((entry) => entry.type === "Bug Fix"),
  };
}

export function getChangeLogEntryGroups(): ChangeLogEntryGroup[] {
  const groups = new Map<string, ChangeLogEntry[]>();
  for (const entry of getChangeLogEntries()) {
    const current = groups.get(entry.date) ?? [];
    current.push(entry);
    groups.set(entry.date, current);
  }
  return [...groups.entries()]
    .sort(([leftDate], [rightDate]) => rightDate.localeCompare(leftDate))
    .map(([date, entries]) => ({
      date,
      entries,
      features: entries.filter((entry) => entry.type === "Feature"),
      bugFixes: entries.filter((entry) => entry.type === "Bug Fix"),
    }));
}
