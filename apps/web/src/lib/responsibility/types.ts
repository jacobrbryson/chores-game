// The pillar list, emoji, and normalizer live in @packages/core so the web
// dialog and the mobile chore editor render the exact same picker. Re-exported
// here so existing `@/lib/responsibility/types` imports keep working.
import type { ResponsibilityPillar } from "@packages/core";

export {
  RESPONSIBILITY_PILLARS,
  RESPONSIBILITY_PILLAR_EMOJI,
  normalizeResponsibilityPillar,
  type ResponsibilityPillar,
} from "@packages/core";

export const RESPONSIBILITY_XP_EVENT_TYPES = [
  "chore_completed",
  "routine_step_completed",
  "routine_completed",
  "new_skill_bonus",
] as const;

export type ResponsibilityXpEventType = (typeof RESPONSIBILITY_XP_EVENT_TYPES)[number];

// One immutable XP award. Events are append-only and additive — progress is
// accumulated into a per-player aggregate document, never recalculated from
// scratch.
export type ResponsibilityXpEvent = {
  playerId: string;
  pillar: ResponsibilityPillar;
  xpAwarded: number;
  eventType: ResponsibilityXpEventType;
  choreId?: string;
  routineId?: string;
  createdAt: string;
};

export type ResponsibilityPillarProgress = {
  pillar: ResponsibilityPillar;
  xp: number;
  level: number;
  currentLevelFloorXp: number;
  nextLevelXp: number | null;
  progressFraction: number;
  // Responsibility Identity layer: the current title tier (0-based), the next
  // title tier (null at the top), and progress across the whole band toward it.
  // Title display names are resolved client-side via `responsibility.titles.*`
  // locale keys so this stays language-agnostic.
  titleTier: number;
  nextTitleTier: number | null;
  titleProgressFraction: number;
};

export type ResponsibilityProgressSummary = {
  playerId: string;
  totalXp: number;
  skillsLearned: number;
  routinesCompleted: number;
  mostActivePillar: ResponsibilityPillar | "";
  mostCompletedRoutine: { routineId: string; name: string; count: number } | null;
  pillars: ResponsibilityPillarProgress[];
};
