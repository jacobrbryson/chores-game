// Responsibility Identity titles. Titles are an identity layer over the
// existing XP/level system — they introduce no second progression. A pillar's
// current title is derived purely from its level (which is derived from XP),
// banded into 7 tiers. Everything here is pure and client-safe so the web app
// (and a future mobile app) can render titles from the same rules.
import {
  DEFAULT_LEVEL_THRESHOLDS,
  xpFloorForLevel,
  levelForXp,
} from "@/lib/responsibility/levels";
import type { ResponsibilityPillar } from "@/lib/responsibility/types";

export const TITLE_TIER_COUNT = 7;

// Canonical English title names, tier 0..6 per pillar. The UI renders titles
// from the `responsibility.titles.*` locale keys (localized), but server-side
// family-activity feed messages are plain English throughout this codebase, so
// the "became a {title}" announcements use these names directly.
export const RESPONSIBILITY_TITLE_NAMES_EN: Record<ResponsibilityPillar, string[]> = {
  home_care: [
    "Helper",
    "Housekeeper",
    "Chore Master",
    "Home Guardian",
    "Household Hero",
    "Steward of the Home",
    "Master Homemaker",
  ],
  self_care: [
    "Self Starter",
    "Independent Kid",
    "Self Care Pro",
    "Self Reliance Expert",
    "Self Mastery Champion",
    "Personal Growth Hero",
    "Master of Self",
  ],
  organization: [
    "Organizer",
    "Planner",
    "Coordinator",
    "Efficiency Expert",
    "Master Organizer",
    "Logistics Champion",
    "Order Keeper",
  ],
  family_contribution: [
    "Contributor",
    "Team Player",
    "Family Helper",
    "Family Champion",
    "Pillar of the Family",
    "Family Leader",
    "Family Hero",
  ],
  life_skills: [
    "Learner",
    "Problem Solver",
    "Pathfinder",
    "Life Skills Expert",
    "Capable Adult",
    "Community Builder",
    "Master of Life Skills",
  ],
};

// English title name for a pillar + 0-based tier, clamped to valid bounds.
export function titleNameEn(pillar: ResponsibilityPillar, tier: number): string {
  const names = RESPONSIBILITY_TITLE_NAMES_EN[pillar];
  const index = Math.min(Math.max(0, Math.trunc(tier)), names.length - 1);
  return names[index];
}

// Minimum 1-based level required to hold each title tier. Level 1 has no
// level 1; the bands intentionally mirror the spec (1-4, 5-9, 10-14, …, 30+)
// and are kept configurable so balancing can move them later without code
// changes elsewhere.
export const DEFAULT_TITLE_LEVEL_BANDS = [2, 5, 10, 15, 20, 25, 30] as const;

function sanitizeBands(bands: readonly number[]): number[] {
  const cleaned = bands
    .filter((value) => Number.isFinite(value) && value >= 1)
    .map((value) => Math.trunc(value));
  if (cleaned.length !== TITLE_TIER_COUNT || cleaned[0] < 2) {
    return [...DEFAULT_TITLE_LEVEL_BANDS];
  }
  for (let i = 1; i < cleaned.length; i += 1) {
    if (cleaned[i] <= cleaned[i - 1]) {
      return [...DEFAULT_TITLE_LEVEL_BANDS];
    }
  }
  return cleaned;
}

// Title tier for a given 1-based level. Returns -1 when no title is earned yet,
// otherwise 0..TITLE_TIER_COUNT-1.
export function titleTierForLevel(
  level: number,
  bands: readonly number[] = DEFAULT_TITLE_LEVEL_BANDS,
): number {
  const safeBands = sanitizeBands(bands);
  const safeLevel = Number.isFinite(level) && level > 1 ? Math.trunc(level) : 1;
  if (safeLevel < safeBands[0]) {
    return -1;
  }
  let tier = 0;
  for (let i = 1; i < safeBands.length; i += 1) {
    if (safeLevel >= safeBands[i]) {
      tier = i;
    } else {
      break;
    }
  }
  return tier;
}

export type TitleProgress = {
  // Current title tier, or -1 when no title is earned yet.
  tier: number;
  // Next 0-based title tier, or null when already at the top tier.
  nextTier: number | null;
  // 0..1 progress across the *whole level band* between the current title and
  // the next one (not progress within a single level). 1 at the top tier.
  titleProgressFraction: number;
};

// Derives the current title tier and progress toward the next title from a
// pillar's cumulative XP. Progress spans the entire band of levels the next
// title requires, measured in XP against the level thresholds.
export function titleProgressForPillar(input: {
  xp: number;
  thresholds?: number[];
  bands?: readonly number[];
}): TitleProgress {
  const thresholds = input.thresholds ?? DEFAULT_LEVEL_THRESHOLDS;
  const safeBands = sanitizeBands(input.bands ?? DEFAULT_TITLE_LEVEL_BANDS);
  const xp = Number.isFinite(input.xp) && input.xp > 0 ? Math.trunc(input.xp) : 0;
  const level = levelForXp(xp, thresholds);
  const tier = titleTierForLevel(level, safeBands);
  if (tier < 0) {
    const firstTitleFloorXp = xpFloorForLevel(safeBands[0], thresholds);
    const fraction =
      firstTitleFloorXp > 0 ? Math.min(1, Math.max(0, xp / firstTitleFloorXp)) : 0;
    return { tier, nextTier: 0, titleProgressFraction: fraction };
  }
  if (tier >= safeBands.length - 1) {
    return { tier, nextTier: null, titleProgressFraction: 1 };
  }
  const bandFloorXp = xpFloorForLevel(safeBands[tier], thresholds);
  const nextBandFloorXp = xpFloorForLevel(safeBands[tier + 1], thresholds);
  const span = nextBandFloorXp - bandFloorXp;
  const fraction =
    span > 0 ? Math.min(1, Math.max(0, (xp - bandFloorXp) / span)) : 0;
  return { tier, nextTier: tier + 1, titleProgressFraction: fraction };
}

// Returns the newly-reached title tier if an XP gain crossed a title boundary,
// otherwise null. Used to fire title-unlock celebrations and parent-feed
// announcements only on the completion that actually levels the title up.
export function titleUnlockTier(
  prevXp: number,
  nextXp: number,
  thresholds: number[] = DEFAULT_LEVEL_THRESHOLDS,
  bands: readonly number[] = DEFAULT_TITLE_LEVEL_BANDS,
): number | null {
  const safeBands = sanitizeBands(bands);
  const prevTier = titleTierForLevel(levelForXp(prevXp, thresholds), safeBands);
  const nextTier = titleTierForLevel(levelForXp(nextXp, thresholds), safeBands);
  return nextTier > prevTier ? nextTier : null;
}
