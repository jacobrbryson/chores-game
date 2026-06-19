import { readBoolean, type FirestoreValue } from "@/lib/firestore/rest";

// Shared request/document parsing helpers for the chores API routes.

export function normalizeDescription(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeAssigneeIds(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

export function readOptionalSortOrder(fields: Record<string, FirestoreValue> | undefined) {
  const value = fields?.sortOrder;
  if (!value) {
    return undefined;
  }
  const raw =
    "integerValue" in value
      ? value.integerValue
      : "stringValue" in value
        ? value.stringValue
        : "";
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  const normalized = Math.floor(parsed);
  if (normalized < 0) {
    return undefined;
  }
  return normalized;
}

export function todayIsoDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Returns the value when it is a valid YYYY-MM-DD string, otherwise "".
export function asValidDate(value: unknown) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  return "";
}

// Returns the value when it is a valid YYYY-MM-DD string, otherwise today.
export function asDateOrToday(value: unknown) {
  return asValidDate(value) || todayIsoDate();
}

// Create route: missing/invalid means "enabled".
export function parseNewSkillEnabled(value: unknown) {
  return typeof value === "boolean" ? value : true;
}

// Edit route: missing means "leave unchanged" (undefined).
export function parseOptionalNewSkillEnabled(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

// Stored chores without the field default to enabled.
export function resolveStoredNewSkillEnabled(fields: Record<string, FirestoreValue> | undefined) {
  if (!fields || !Object.prototype.hasOwnProperty.call(fields, "newSkillEnabled")) {
    return true;
  }
  return readBoolean(fields, "newSkillEnabled");
}
