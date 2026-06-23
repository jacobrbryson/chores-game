import { describe, expect, it } from "vitest";
import { DEFAULT_LEVEL_THRESHOLDS, xpFloorForLevel } from "./levels";
import {
  DEFAULT_TITLE_LEVEL_BANDS,
  TITLE_TIER_COUNT,
  titleProgressForPillar,
  titleTierForLevel,
  titleUnlockTier,
} from "./titles";

// Default thresholds [0,100,250,500,900] extrapolate by gap 400 past level 5,
// so the title-band level floors land at these XP values:
const XP_L2 = xpFloorForLevel(DEFAULT_TITLE_LEVEL_BANDS[0]); // 100
const XP_L5 = xpFloorForLevel(DEFAULT_TITLE_LEVEL_BANDS[1]); // 900
const XP_L10 = xpFloorForLevel(DEFAULT_TITLE_LEVEL_BANDS[2]); // 2900
const XP_L30 = xpFloorForLevel(DEFAULT_TITLE_LEVEL_BANDS[6]); // 10900

describe("titleTierForLevel", () => {
  it("bands levels into 7 tiers at the configured edges", () => {
    expect(titleTierForLevel(1)).toBe(-1);
    expect(titleTierForLevel(2)).toBe(0);
    expect(titleTierForLevel(4)).toBe(0);
    expect(titleTierForLevel(5)).toBe(1);
    expect(titleTierForLevel(9)).toBe(1);
    expect(titleTierForLevel(10)).toBe(2);
    expect(titleTierForLevel(29)).toBe(5);
    expect(titleTierForLevel(30)).toBe(6);
  });

  it("clamps above the top band and below level 1", () => {
    expect(titleTierForLevel(99)).toBe(TITLE_TIER_COUNT - 1);
    expect(titleTierForLevel(0)).toBe(-1);
    expect(titleTierForLevel(-5)).toBe(-1);
  });

  it("falls back to default bands for malformed input", () => {
    expect(titleTierForLevel(5, [1, 1, 2])).toBe(1);
    expect(titleTierForLevel(1, [1, 5, 10, 15, 20, 25, 30])).toBe(-1);
  });
});

describe("titleProgressForPillar", () => {
  it("reports the tier, next tier, and fraction across the whole band", () => {
    const atBandStart = titleProgressForPillar({ xp: XP_L5 });
    expect(atBandStart.tier).toBe(1);
    expect(atBandStart.nextTier).toBe(2);
    expect(atBandStart.titleProgressFraction).toBe(0);

    const midBand = titleProgressForPillar({ xp: (XP_L5 + XP_L10) / 2 });
    expect(midBand.tier).toBe(1);
    expect(midBand.titleProgressFraction).toBeCloseTo(0.5);
  });

  it("clamps to the top tier with a full bar and no next tier", () => {
    const top = titleProgressForPillar({ xp: XP_L30 + 5000 });
    expect(top.tier).toBe(TITLE_TIER_COUNT - 1);
    expect(top.nextTier).toBeNull();
    expect(top.titleProgressFraction).toBe(1);
  });

  it("has no current title at zero XP and points to the first title", () => {
    const zero = titleProgressForPillar({ xp: 0 });
    expect(zero.tier).toBe(-1);
    expect(zero.nextTier).toBe(0);
    expect(zero.titleProgressFraction).toBe(0);
  });
});

describe("titleUnlockTier", () => {
  it("returns tier 0 when XP crosses the first title boundary", () => {
    expect(titleUnlockTier(XP_L2 - 1, XP_L2, DEFAULT_LEVEL_THRESHOLDS)).toBe(0);
  });

  it("returns the new tier when XP crosses a title boundary", () => {
    expect(titleUnlockTier(XP_L5 - 50, XP_L5, DEFAULT_LEVEL_THRESHOLDS)).toBe(1);
  });

  it("returns null when no boundary is crossed", () => {
    expect(titleUnlockTier(XP_L5, XP_L5 + 10, DEFAULT_LEVEL_THRESHOLDS)).toBeNull();
    expect(titleUnlockTier(0, 50, DEFAULT_LEVEL_THRESHOLDS)).toBeNull();
  });

  it("handles a multi-tier jump by returning the final tier", () => {
    expect(titleUnlockTier(0, XP_L10, DEFAULT_LEVEL_THRESHOLDS)).toBe(2);
  });
});
