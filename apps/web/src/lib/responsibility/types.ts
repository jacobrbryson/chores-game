// Responsibility Pillars: a first-class domain concept describing which life
// skill a chore or routine develops. Pillars are intentionally separate from
// user-defined chore Categories — Categories answer "where does this chore
// belong?", pillars answer "what life skill does this chore develop?".
export const RESPONSIBILITY_PILLARS = [
  "home_care",
  "self_care",
  "organization",
  "family_contribution",
  "life_skills",
] as const;

export type ResponsibilityPillar = (typeof RESPONSIBILITY_PILLARS)[number];

export const RESPONSIBILITY_PILLAR_EMOJI: Record<ResponsibilityPillar, string> = {
  home_care: "🏠",
  self_care: "🌱",
  organization: "📋",
  family_contribution: "🤝",
  life_skills: "🛠️",
};

// Pillar assignment is always optional. Unknown or empty values normalize to
// "" so existing chores (and any malformed data) keep working untouched.
export function normalizeResponsibilityPillar(value: unknown): ResponsibilityPillar | "" {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  return (RESPONSIBILITY_PILLARS as readonly string[]).includes(trimmed)
    ? (trimmed as ResponsibilityPillar)
    : "";
}

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
