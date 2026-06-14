import {
  readBoolean,
  readInteger,
  readString,
  readStringArray,
  readTimestamp,
  documentIdFromName,
  type FirestoreValue,
} from "@/lib/firestore/rest";
import {
  normalizeResponsibilityPillar,
  type ResponsibilityPillar,
} from "@/lib/responsibility/types";

// Routines are reusable parent-defined templates: a named, ordered list of
// small steps (e.g. "Dinner Cleanup" → clear table, load dishwasher, wipe
// counters, sweep floor) that teaches a larger responsibility. Templates are
// assigned many times; each assignment snapshots the steps (see
// assignments.ts) so editing a template never rewrites history.
//
// Storage:
// - families/{familyId}/routines/{routineId} — the routine template.
// - families/{familyId}/routineAssignments/{assignmentId} — one assigned
//   occurrence for one player (see assignments.ts).
export const MAX_ROUTINE_STEPS = 20;
export const MAX_ROUTINES_PER_FAMILY = 50;
export const MAX_ROUTINE_NAME_LENGTH = 120;
export const MAX_ROUTINE_DESCRIPTION_LENGTH = 500;
export const MAX_ROUTINE_STEP_TITLE_LENGTH = 160;

export type RoutineStep = {
  id: string;
  title: string;
  // Optional explicit chore settings, set when the parent customized them in
  // the routine editor. When absent, assignment falls back to the family's
  // existing chore with the same title (chores stay the source of truth).
  coinValue?: number;
  requireApproval?: boolean;
};

export type RoutineDefinition = {
  id: string;
  name: string;
  description: string;
  pillar: ResponsibilityPillar | "";
  steps: RoutineStep[];
  // -1 means "use the globally configured default bonus".
  completionBonusXp: number;
  completionBonusCoins: number;
  assigneeIds: string[];
  active: boolean;
  timesUsed: number;
  timesCompleted: number;
  createdBy: string;
  createdAt?: string;
  updatedAt?: string;
};

function sanitizeIdPart(value: string) {
  return value.replace(/[^a-zA-Z0-9_.@-]/g, "_");
}

export function sanitizeRoutineIdPart(value: string) {
  return sanitizeIdPart(value);
}

// Validates and normalizes raw step input from the API. Returns null when the
// payload is unusable (empty, too many steps, bad titles).
export function normalizeRoutineSteps(value: unknown): RoutineStep[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ROUTINE_STEPS) {
    return null;
  }
  const steps: RoutineStep[] = [];
  const seenIds = new Set<string>();
  for (let i = 0; i < value.length; i += 1) {
    const entry = value[i];
    if (!entry || typeof entry !== "object") {
      return null;
    }
    const title =
      "title" in entry && typeof entry.title === "string" ? entry.title.trim() : "";
    if (!title || title.length > MAX_ROUTINE_STEP_TITLE_LENGTH) {
      return null;
    }
    const rawId =
      "id" in entry && typeof entry.id === "string" && entry.id.trim()
        ? sanitizeIdPart(entry.id.trim()).slice(0, 60)
        : `step_${i + 1}`;
    const id = seenIds.has(rawId) ? `${rawId}_${i + 1}` : rawId;
    seenIds.add(id);
    const coinValueRaw = (entry as { coinValue?: unknown }).coinValue;
    const coinValue =
      typeof coinValueRaw === "number" && Number.isFinite(coinValueRaw)
        ? Math.max(0, Math.min(1000, Math.trunc(coinValueRaw)))
        : undefined;
    const requireApprovalRaw = (entry as { requireApproval?: unknown }).requireApproval;
    steps.push({
      id,
      title,
      ...(coinValue !== undefined ? { coinValue } : {}),
      ...(typeof requireApprovalRaw === "boolean"
        ? { requireApproval: requireApprovalRaw }
        : {}),
    });
  }
  return steps;
}

export function parseRoutineStepsJson(json: string): RoutineStep[] {
  if (!json) {
    return [];
  }
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(
        (entry): entry is { id: string; title: string } =>
          Boolean(entry) &&
          typeof entry === "object" &&
          typeof (entry as { id?: unknown }).id === "string" &&
          typeof (entry as { title?: unknown }).title === "string",
      )
      .map((entry) => {
        const coinValue = (entry as { coinValue?: unknown }).coinValue;
        const requireApproval = (entry as { requireApproval?: unknown }).requireApproval;
        return {
          id: entry.id,
          title: entry.title,
          ...(typeof coinValue === "number" && Number.isFinite(coinValue)
            ? { coinValue: Math.max(0, Math.trunc(coinValue)) }
            : {}),
          ...(typeof requireApproval === "boolean" ? { requireApproval } : {}),
        };
      });
  } catch {
    return [];
  }
}

export function routineFromDoc(doc: {
  name: string;
  fields?: Record<string, FirestoreValue>;
}): RoutineDefinition {
  const completionBonusXpRaw =
    doc.fields && "completionBonusXp" in doc.fields
      ? readInteger(doc.fields, "completionBonusXp")
      : -1;
  return {
    id: documentIdFromName(doc.name),
    name: readString(doc.fields, "name") || "Untitled routine",
    description: readString(doc.fields, "description"),
    pillar: normalizeResponsibilityPillar(readString(doc.fields, "pillar")),
    steps: parseRoutineStepsJson(readString(doc.fields, "stepsJson")),
    completionBonusXp: completionBonusXpRaw >= 0 ? completionBonusXpRaw : -1,
    completionBonusCoins: Math.max(0, readInteger(doc.fields, "completionBonusCoins")),
    assigneeIds: readStringArray(doc.fields, "assigneeIds"),
    active: doc.fields && "active" in doc.fields ? readBoolean(doc.fields, "active") : true,
    timesUsed: Math.max(0, readInteger(doc.fields, "timesUsed")),
    timesCompleted: Math.max(0, readInteger(doc.fields, "timesCompleted")),
    createdBy: readString(doc.fields, "createdBy"),
    createdAt: readTimestamp(doc.fields, "createdAt") || undefined,
    updatedAt: readTimestamp(doc.fields, "updatedAt") || undefined,
  };
}

export function parseCompletedStepIdsJson(json: string): string[] {
  if (!json) {
    return [];
  }
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}
