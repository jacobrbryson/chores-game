import {
  documentIdFromName,
  readBoolean,
  readInteger,
  readString,
  readTimestamp,
  type FirestoreValue,
} from "@/lib/firestore/rest";
import { parseRoutineStepsJson, type RoutineStep } from "@/lib/responsibility/routines";
import {
  normalizeResponsibilityPillar,
  type ResponsibilityPillar,
} from "@/lib/responsibility/types";

// Platform-wide curated catalog backing future chore/routine recommendations
// ("What should my 10-year-old work on?"). Both collections are top-level and
// support-curated; families read them through session-gated API routes that
// use admin credentials server-side (the content is non-sensitive).
//
// - responsibilityChoreSuggestions/{id} — curated chore ideas tagged by
//   pillar, age range, difficulty, estimated time, and popularity.
// - communityRoutines/{id} — shared routine templates with an approval
//   workflow (pending → approved/rejected) and a featured flag. Public
//   publishing UI is intentionally not built yet; support seeds the library.
export const CHORE_SUGGESTIONS_COLLECTION = "responsibilityChoreSuggestions";
export const COMMUNITY_ROUTINES_COLLECTION = "communityRoutines";

export const SUGGESTION_DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type SuggestionDifficulty = (typeof SUGGESTION_DIFFICULTIES)[number];

export function normalizeSuggestionDifficulty(value: unknown): SuggestionDifficulty {
  return value === "easy" || value === "hard" ? value : "medium";
}

export type ChoreSuggestion = {
  id: string;
  title: string;
  pillar: ResponsibilityPillar | "";
  minAge: number;
  maxAge: number;
  difficulty: SuggestionDifficulty;
  estimatedMinutes: number;
  popularity: number;
  active: boolean;
  createdAt?: string;
};

export function choreSuggestionFromDoc(doc: {
  name: string;
  fields?: Record<string, FirestoreValue>;
}): ChoreSuggestion {
  return {
    id: documentIdFromName(doc.name),
    title: readString(doc.fields, "title") || "Untitled suggestion",
    pillar: normalizeResponsibilityPillar(readString(doc.fields, "pillar")),
    minAge: Math.max(0, readInteger(doc.fields, "minAge")),
    maxAge: Math.max(0, readInteger(doc.fields, "maxAge")) || 18,
    difficulty: normalizeSuggestionDifficulty(readString(doc.fields, "difficulty")),
    estimatedMinutes: Math.max(0, readInteger(doc.fields, "estimatedMinutes")),
    popularity: Math.max(0, readInteger(doc.fields, "popularity")),
    active: doc.fields && "active" in doc.fields ? readBoolean(doc.fields, "active") : true,
    createdAt: readTimestamp(doc.fields, "createdAt") || undefined,
  };
}

export const COMMUNITY_ROUTINE_STATUSES = ["pending", "approved", "rejected"] as const;
export type CommunityRoutineStatus = (typeof COMMUNITY_ROUTINE_STATUSES)[number];

export function normalizeCommunityRoutineStatus(value: unknown): CommunityRoutineStatus {
  return value === "approved" || value === "rejected" ? value : "pending";
}

export type CommunityRoutine = {
  id: string;
  name: string;
  pillar: ResponsibilityPillar | "";
  steps: RoutineStep[];
  minAge: number;
  maxAge: number;
  status: CommunityRoutineStatus;
  featured: boolean;
  submittedBy: string;
  createdAt?: string;
};

export function communityRoutineFromDoc(doc: {
  name: string;
  fields?: Record<string, FirestoreValue>;
}): CommunityRoutine {
  return {
    id: documentIdFromName(doc.name),
    name: readString(doc.fields, "name") || "Untitled routine",
    pillar: normalizeResponsibilityPillar(readString(doc.fields, "pillar")),
    steps: parseRoutineStepsJson(readString(doc.fields, "stepsJson")),
    minAge: Math.max(0, readInteger(doc.fields, "minAge")),
    maxAge: Math.max(0, readInteger(doc.fields, "maxAge")) || 18,
    status: normalizeCommunityRoutineStatus(readString(doc.fields, "status")),
    featured: readBoolean(doc.fields, "featured"),
    submittedBy: readString(doc.fields, "submittedBy"),
    createdAt: readTimestamp(doc.fields, "createdAt") || undefined,
  };
}

export type SuggestionFilters = {
  pillar?: ResponsibilityPillar | "";
  age?: number;
  difficulty?: SuggestionDifficulty | "";
  maxMinutes?: number;
};

export function filterChoreSuggestions(
  suggestions: ChoreSuggestion[],
  filters: SuggestionFilters,
): ChoreSuggestion[] {
  return suggestions
    .filter((suggestion) => suggestion.active)
    .filter((suggestion) => !filters.pillar || suggestion.pillar === filters.pillar)
    .filter((suggestion) => {
      if (filters.age === undefined || !Number.isFinite(filters.age)) {
        return true;
      }
      return filters.age >= suggestion.minAge && filters.age <= suggestion.maxAge;
    })
    .filter(
      (suggestion) => !filters.difficulty || suggestion.difficulty === filters.difficulty,
    )
    .filter((suggestion) => {
      if (filters.maxMinutes === undefined || !Number.isFinite(filters.maxMinutes)) {
        return true;
      }
      return suggestion.estimatedMinutes <= filters.maxMinutes;
    })
    .sort((a, b) => b.popularity - a.popularity || a.title.localeCompare(b.title));
}
