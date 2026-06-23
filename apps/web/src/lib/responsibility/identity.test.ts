import { describe, expect, it } from "vitest";
import { primaryJourneyPillar, topEarnedIdentities, type PillarIdentity } from "./identity";

function ident(
  pillar: PillarIdentity["pillar"],
  titleTier: number,
  xp: number,
  level = 2,
): PillarIdentity {
  return { pillar, level, titleTier, nextTitleTier: titleTier + 1, titleProgressFraction: 0.5, xp };
}

const pillars: PillarIdentity[] = [
  ident("home_care", 2, 900),
  ident("self_care", 0, 0, 1),
  ident("organization", 1, 1200),
  ident("family_contribution", 1, 300),
  ident("life_skills", 0, 0, 1),
];

describe("topEarnedIdentities", () => {
  it("keeps only pillars above starter level, ordered by tier then XP", () => {
    const result = topEarnedIdentities(pillars);
    expect(result.map((entry) => entry.pillar)).toEqual([
      "home_care", // tier 2
      "organization", // tier 1, 1200 xp
      "family_contribution", // tier 1, 300 xp
    ]);
  });

  it("respects the limit", () => {
    expect(topEarnedIdentities(pillars, 2).map((e) => e.pillar)).toEqual([
      "home_care",
      "organization",
    ]);
  });

  it("returns empty when nothing is started", () => {
    expect(topEarnedIdentities([ident("self_care", 0, 0, 1)])).toEqual([]);
  });

  it("does not count level 1 starter titles as earned identities", () => {
    expect(topEarnedIdentities([ident("home_care", 0, 50, 1)])).toEqual([]);
  });

  it("falls back to started XP for legacy payloads without a level", () => {
    const legacy = { ...ident("home_care", 0, 50) };
    delete legacy.level;
    expect(topEarnedIdentities([legacy]).map((entry) => entry.pillar)).toEqual(["home_care"]);
  });
});

describe("primaryJourneyPillar", () => {
  it("returns the highest-XP started pillar", () => {
    expect(primaryJourneyPillar(pillars)?.pillar).toBe("organization");
  });

  it("returns null when all pillars are at zero XP", () => {
    expect(primaryJourneyPillar([ident("self_care", 0, 0, 1)])).toBeNull();
  });
});
