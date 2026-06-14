import { describe, expect, it } from "vitest";
import {
  DEFAULT_LEVEL_THRESHOLDS,
  levelForXp,
  levelProgressForXp,
  xpFloorForLevel,
} from "./levels";

describe("levelForXp", () => {
  it("starts at level 1 with zero or negative XP", () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(-50)).toBe(1);
  });

  it("crosses configured thresholds exactly at the boundary", () => {
    expect(levelForXp(99)).toBe(1);
    expect(levelForXp(100)).toBe(2);
    expect(levelForXp(249)).toBe(2);
    expect(levelForXp(250)).toBe(3);
    expect(levelForXp(500)).toBe(4);
    expect(levelForXp(900)).toBe(5);
  });

  it("extrapolates beyond the configured list using the last gap", () => {
    // Default last gap is 900 - 500 = 400, so level 6 starts at 1300.
    expect(levelForXp(1299)).toBe(5);
    expect(levelForXp(1300)).toBe(6);
    expect(levelForXp(1700)).toBe(7);
  });

  it("supports custom thresholds", () => {
    const thresholds = [0, 10, 30];
    expect(levelForXp(9, thresholds)).toBe(1);
    expect(levelForXp(10, thresholds)).toBe(2);
    expect(levelForXp(30, thresholds)).toBe(3);
    expect(levelForXp(50, thresholds)).toBe(4); // gap 20 → level 4 at 50
  });

  it("falls back to defaults for malformed thresholds", () => {
    expect(levelForXp(100, [5, 3])).toBe(2);
    expect(levelForXp(100, [])).toBe(2);
    expect(levelForXp(100, [0, 100, 100])).toBe(2);
  });
});

describe("xpFloorForLevel", () => {
  it("returns the configured floors and extrapolates past them", () => {
    expect(xpFloorForLevel(1)).toBe(0);
    expect(xpFloorForLevel(2)).toBe(100);
    expect(xpFloorForLevel(5)).toBe(900);
    expect(xpFloorForLevel(6)).toBe(1300);
    expect(xpFloorForLevel(7)).toBe(1700);
  });
});

describe("levelProgressForXp", () => {
  it("reports fraction toward the next level", () => {
    const progress = levelProgressForXp(175, DEFAULT_LEVEL_THRESHOLDS);
    expect(progress.level).toBe(2);
    expect(progress.currentLevelFloorXp).toBe(100);
    expect(progress.nextLevelXp).toBe(250);
    expect(progress.progressFraction).toBeCloseTo(0.5);
  });

  it("clamps to [0, 1]", () => {
    expect(levelProgressForXp(0).progressFraction).toBe(0);
    expect(levelProgressForXp(-10).progressFraction).toBe(0);
  });
});
