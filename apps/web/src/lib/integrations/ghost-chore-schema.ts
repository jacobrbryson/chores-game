/**
 * Shared, type-safe contract for Athena-powered ghost chore suggestions.
 *
 * This is the single source of truth for the request payload Family Chores sends
 * to Athena and the structured response Athena returns. The Athena service
 * (`core_api/src/services/ghostChoreSuggestions.js`) mirrors this shape; this
 * module additionally provides a *defensive* parser so we never trust the
 * upstream JSON blindly (Athena is an AI — its output must be validated and
 * clamped before it reaches a child's screen or becomes a real chore).
 */

import {
  ghostSuggestionId,
  isSafeChoreTitle,
  normalizeGhostCoinValue,
  normalizeGhostText,
  type GhostChoreSuggestion,
} from "@/lib/ghost-chores";

// --- Request contract -------------------------------------------------------

export type GhostChoreSubjectRole = "admin" | "player";

/** A minimized chore reference sent to Athena for context (never PII-heavy). */
export type GhostContextChore = {
  title: string;
  coinValue?: number;
  category?: string;
};

/**
 * The sanitized context payload Family Chores sends to Athena. Only what Athena
 * needs for high-quality, age-aware suggestions — no tokens, no emails, no
 * free-form child notes.
 */
export type GhostChoreSuggestRequest = {
  user: {
    id: string;
    role: GhostChoreSubjectRole;
    displayName?: string;
    birthYear?: number;
    age?: number;
  };
  tenureDays?: number;
  totalChoresCompleted?: number;
  coinBalance?: number;
  activeChores: GhostContextChore[];
  recentlyCompleted: GhostContextChore[];
  pastChores: GhostContextChore[];
  recentSuggestionActivity: {
    suggested: GhostContextChore[];
    dismissed: GhostContextChore[];
    accepted: GhostContextChore[];
  };
  categories: string[];
  familySettings: {
    minCoin?: number;
    maxCoin?: number;
    requireApproval: boolean;
  };
  count?: number;
};

// --- Response contract ------------------------------------------------------

export const GHOST_DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type GhostDifficulty = (typeof GHOST_DIFFICULTIES)[number];

export const GHOST_SUGGESTION_TYPES = [
  "repeat",
  "next_step",
  "skill_building",
  "novelty",
] as const;
export type GhostSuggestionType = (typeof GHOST_SUGGESTION_TYPES)[number];

/** One structured suggestion as returned by Athena. */
export type AthenaGhostSuggestion = {
  title: string;
  description: string;
  difficulty: GhostDifficulty;
  estimatedMinutes: number | null;
  suggestedCoins: number;
  category: string | null;
  pillar: string | null;
  suggestionType: GhostSuggestionType;
  reason: string;
  confidence: number;
  requiresParentReview: boolean;
  safetyNotes: string | null;
};

export type AthenaGhostMeta = {
  source: "athena";
  modelVersion: string;
  generatedAt: string;
};

export type AthenaGhostResponse = {
  suggestions: AthenaGhostSuggestion[];
  meta: AthenaGhostMeta;
};

// --- Defensive parsing ------------------------------------------------------

function asString(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function asIntInRange(value: unknown, min: number, max: number): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function asDifficulty(value: unknown): GhostDifficulty {
  return GHOST_DIFFICULTIES.includes(value as GhostDifficulty)
    ? (value as GhostDifficulty)
    : "easy";
}

function asSuggestionType(value: unknown): GhostSuggestionType {
  return GHOST_SUGGESTION_TYPES.includes(value as GhostSuggestionType)
    ? (value as GhostSuggestionType)
    : "novelty";
}

/**
 * Validate + clamp one raw suggestion. Returns null when it cannot be made safe
 * (no title, or fails the same hard safety keyword filter local suggestions
 * must pass). `forceParentReview` is true for child/player subjects so a child
 * can never be handed a suggestion that bypasses parent approval.
 */
export function normalizeAthenaSuggestion(
  raw: unknown,
  options: { forceParentReview: boolean },
): AthenaGhostSuggestion | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  const title = asString(entry.title, 120);
  if (!title) return null;
  const description = asString(entry.description, 280);
  // Reuse the local safety guardrail — Athena is not exempt from it.
  if (!isSafeChoreTitle(title, description)) return null;

  let confidence = typeof entry.confidence === "number" ? entry.confidence : Number(entry.confidence);
  if (!Number.isFinite(confidence)) confidence = 0.5;
  confidence = Math.min(1, Math.max(0, confidence));

  return {
    title,
    description,
    difficulty: asDifficulty(entry.difficulty),
    estimatedMinutes: asIntInRange(entry.estimatedMinutes, 1, 600),
    suggestedCoins: asIntInRange(entry.suggestedCoins, 0, 1000) ?? 0,
    category: asString(entry.category, 60) || null,
    pillar: asString(entry.pillar, 60) || null,
    suggestionType: asSuggestionType(entry.suggestionType),
    reason: asString(entry.reason, 280),
    confidence: Math.round(confidence * 100) / 100,
    requiresParentReview: options.forceParentReview ? true : entry.requiresParentReview !== false,
    safetyNotes: asString(entry.safetyNotes, 280) || null,
  };
}

/**
 * Parse and validate the full Athena response. Throws nothing — returns a
 * normalized list (possibly empty) plus meta. The caller decides whether an
 * empty list means "fall back to local".
 */
export function parseAthenaGhostResponse(
  raw: unknown,
  options: { forceParentReview: boolean },
): { suggestions: AthenaGhostSuggestion[]; meta: AthenaGhostMeta } {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(obj.suggestions) ? obj.suggestions : [];
  const suggestions = list
    .map((entry) => normalizeAthenaSuggestion(entry, options))
    .filter((entry): entry is AthenaGhostSuggestion => entry !== null);

  const rawMeta = (obj.meta && typeof obj.meta === "object" ? obj.meta : {}) as Record<string, unknown>;
  const meta: AthenaGhostMeta = {
    source: "athena",
    modelVersion: asString(rawMeta.modelVersion, 120) || "unknown",
    generatedAt: asString(rawMeta.generatedAt, 40) || new Date().toISOString(),
  };
  return { suggestions, meta };
}

/**
 * Map a validated Athena suggestion onto the `GhostChoreSuggestion` shape the
 * UI and request/dismiss/convert lifecycle already understand, carrying the
 * extra Athena metadata as optional fields. The id is deterministic on
 * source+title (same scheme as local suggestions) so request/dismiss stay
 * idempotent.
 */
export function athenaToGhostSuggestion(athena: AthenaGhostSuggestion): GhostChoreSuggestion {
  return {
    id: ghostSuggestionId("athena", athena.title),
    suggestedTitle: normalizeGhostText(athena.title, 160),
    suggestedDescription: normalizeGhostText(athena.description, 280),
    suggestedCoinValue: normalizeGhostCoinValue(athena.suggestedCoins),
    suggestedCategoryIds: [],
    source: "athena",
    athena: {
      difficulty: athena.difficulty,
      estimatedMinutes: athena.estimatedMinutes,
      suggestionType: athena.suggestionType,
      reason: athena.reason,
      confidence: athena.confidence,
      requiresParentReview: athena.requiresParentReview,
      safetyNotes: athena.safetyNotes,
      categoryLabel: athena.category,
      pillar: athena.pillar,
    },
  };
}
