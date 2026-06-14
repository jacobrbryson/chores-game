import { describe, expect, it } from "vitest";
import {
  RESPONSIBILITY_PILLARS,
  RESPONSIBILITY_PILLAR_EMOJI,
  normalizeResponsibilityPillar,
} from "./types";

describe("normalizeResponsibilityPillar", () => {
  it("accepts every defined pillar", () => {
    for (const pillar of RESPONSIBILITY_PILLARS) {
      expect(normalizeResponsibilityPillar(pillar)).toBe(pillar);
    }
  });

  it("normalizes unknown, empty, and non-string values to empty string", () => {
    expect(normalizeResponsibilityPillar("")).toBe("");
    expect(normalizeResponsibilityPillar("homecare")).toBe("");
    expect(normalizeResponsibilityPillar("HOME_CARE")).toBe("");
    expect(normalizeResponsibilityPillar(undefined)).toBe("");
    expect(normalizeResponsibilityPillar(null)).toBe("");
    expect(normalizeResponsibilityPillar(42)).toBe("");
    expect(normalizeResponsibilityPillar(["home_care"])).toBe("");
  });

  it("trims whitespace before matching", () => {
    expect(normalizeResponsibilityPillar(" home_care ")).toBe("home_care");
  });
});

describe("pillar metadata", () => {
  it("has an emoji for every pillar", () => {
    for (const pillar of RESPONSIBILITY_PILLARS) {
      expect(RESPONSIBILITY_PILLAR_EMOJI[pillar]).toBeTruthy();
    }
  });
});
