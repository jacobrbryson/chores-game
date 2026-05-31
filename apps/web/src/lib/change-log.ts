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
      } satisfies ChangeLogEntry;
    })
    .sort((left, right) => right.date.localeCompare(left.date) || left.id.localeCompare(right.id));
}

export function getChangeLogEntries(): ChangeLogEntry[] {
  return validateChangeLogEntries(rawChangeLogEntries);
}
