// Level derivation for Responsibility XP. Levels are derived from cumulative
// XP against a configurable ascending threshold list — thresholds[i] is the
// minimum XP for level i + 1. Beyond the configured list, levels continue
// using the gap between the last two thresholds so support can tune early
// levels without capping progression.
export const DEFAULT_LEVEL_THRESHOLDS = [0, 100, 250, 500, 900];

function sanitizeThresholds(thresholds: number[]): number[] {
  const cleaned = thresholds
    .filter((value) => Number.isFinite(value) && value >= 0)
    .map((value) => Math.trunc(value));
  if (cleaned.length === 0 || cleaned[0] !== 0) {
    return DEFAULT_LEVEL_THRESHOLDS;
  }
  for (let i = 1; i < cleaned.length; i += 1) {
    if (cleaned[i] <= cleaned[i - 1]) {
      return DEFAULT_LEVEL_THRESHOLDS;
    }
  }
  return cleaned;
}

function extrapolationGap(thresholds: number[]): number {
  if (thresholds.length < 2) {
    return 100;
  }
  return thresholds[thresholds.length - 1] - thresholds[thresholds.length - 2];
}

// Minimum XP required for a given 1-based level.
export function xpFloorForLevel(level: number, thresholds = DEFAULT_LEVEL_THRESHOLDS): number {
  const safe = sanitizeThresholds(thresholds);
  if (level <= 1) {
    return 0;
  }
  if (level <= safe.length) {
    return safe[level - 1];
  }
  return safe[safe.length - 1] + (level - safe.length) * extrapolationGap(safe);
}

export function levelForXp(xp: number, thresholds = DEFAULT_LEVEL_THRESHOLDS): number {
  const safe = sanitizeThresholds(thresholds);
  const effectiveXp = Number.isFinite(xp) && xp > 0 ? Math.trunc(xp) : 0;
  let level = 1;
  for (let i = 1; i < safe.length; i += 1) {
    if (effectiveXp >= safe[i]) {
      level = i + 1;
    } else {
      return level;
    }
  }
  const gap = extrapolationGap(safe);
  if (gap <= 0) {
    return level;
  }
  return safe.length + Math.floor((effectiveXp - safe[safe.length - 1]) / gap);
}

export type LevelProgress = {
  level: number;
  currentLevelFloorXp: number;
  nextLevelXp: number;
  progressFraction: number;
};

export function levelProgressForXp(
  xp: number,
  thresholds = DEFAULT_LEVEL_THRESHOLDS,
): LevelProgress {
  const effectiveXp = Number.isFinite(xp) && xp > 0 ? Math.trunc(xp) : 0;
  const level = levelForXp(effectiveXp, thresholds);
  const currentLevelFloorXp = xpFloorForLevel(level, thresholds);
  const nextLevelXp = xpFloorForLevel(level + 1, thresholds);
  const span = nextLevelXp - currentLevelFloorXp;
  const progressFraction =
    span > 0 ? Math.min(1, Math.max(0, (effectiveXp - currentLevelFloorXp) / span)) : 0;
  return { level, currentLevelFloorXp, nextLevelXp, progressFraction };
}
