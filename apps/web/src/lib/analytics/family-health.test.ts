import { describe, expect, it } from "vitest";
import {
  DEFAULT_FAMILY_HEALTH_THRESHOLDS,
  buildRiskReasons,
  scoreFamilyHealth,
  type FamilyHealthInputs,
} from "@/lib/analytics/family-health";

// A family firing on all cylinders: parents and kids active today, completions
// flowing, approvals fast, low backlog, and some engagement depth.
const THRIVING: FamilyHealthInputs = {
  daysSinceParentActivity: 0,
  daysSinceChildActivity: 0,
  daysSinceLastActivity: 0,
  choresCreatedRecent: 4,
  choresApprovedRecent: 6,
  approvalInboxOpenedRecent: 3,
  choresCompletedRecent: 8,
  seeAndDoCreatedRecent: 2,
  approvalBacklog: 1,
  avgApprovalHours: 2,
  routineCompletionRate: 0.9,
  storePurchasesRecent: 3,
  pillarXpEarnedRecent: 5,
  identityProgressRecent: 2,
  athenaUsageRecent: 1,
  totalEventsRecent: 40,
};

describe("scoreFamilyHealth", () => {
  it("classifies a fully-active family as healthy with a high score", () => {
    const signal = scoreFamilyHealth(THRIVING);
    expect(signal.state).toBe("healthy");
    expect(signal.score).toBeGreaterThanOrEqual(DEFAULT_FAMILY_HEALTH_THRESHOLDS.healthyMin);
    expect(signal.computed).toBe(true);
    expect(signal.reasons).toEqual([]);
  });

  it("classifies a family with no signal at all as inactive", () => {
    const signal = scoreFamilyHealth({ totalEventsRecent: 0 });
    expect(signal.state).toBe("inactive");
    expect(signal.score).toBe(0);
    expect(signal.reasons).toContain("No meaningful activity in the last 7+ days.");
  });

  it("flags a weakening loop (kids working, parents absent) as at risk", () => {
    const signal = scoreFamilyHealth({
      daysSinceParentActivity: 6,
      daysSinceChildActivity: 0,
      daysSinceLastActivity: 0,
      choresCompletedRecent: 5,
      choresApprovedRecent: 0,
      approvalBacklog: 8,
      avgApprovalHours: 60,
      totalEventsRecent: 12,
    });
    expect(signal.state).toBe("at_risk");
    expect(signal.score).toBeGreaterThanOrEqual(DEFAULT_FAMILY_HEALTH_THRESHOLDS.atRiskMin);
    expect(signal.score).toBeLessThan(DEFAULT_FAMILY_HEALTH_THRESHOLDS.healthyMin);
  });

  it("keeps a barely-active family at risk rather than inactive when score clears the floor", () => {
    const signal = scoreFamilyHealth({
      daysSinceParentActivity: 1,
      daysSinceChildActivity: 1,
      daysSinceLastActivity: 1,
      choresCompletedRecent: 3,
      choresApprovedRecent: 3,
      approvalBacklog: 1,
      totalEventsRecent: 6,
    });
    // Some recent signal exists, so it should never be "inactive".
    expect(signal.state).not.toBe("inactive");
  });

  it("respects custom thresholds", () => {
    const strict = scoreFamilyHealth(THRIVING, { healthyMin: 100, atRiskMin: 50 });
    expect(strict.state).toBe("at_risk");
  });

  it("is pure — identical inputs yield identical output", () => {
    expect(scoreFamilyHealth(THRIVING)).toEqual(scoreFamilyHealth(THRIVING));
  });

  it("handles missing optional signals without throwing", () => {
    expect(() => scoreFamilyHealth({})).not.toThrow();
  });
});

describe("buildRiskReasons", () => {
  it("explains a stalled approval queue and absent parent", () => {
    const reasons = buildRiskReasons({
      daysSinceParentActivity: 5,
      daysSinceChildActivity: 1,
      daysSinceLastActivity: 1,
      choresCompletedRecent: 4,
      choresApprovedRecent: 0,
      approvalBacklog: 12,
      totalEventsRecent: 10,
    });
    expect(reasons).toContain("Parent has not been active in 5 days.");
    expect(reasons).toContain("12 chores are waiting for approval.");
    expect(reasons).toContain("Children completed chores but did not receive rewards.");
  });

  it("explains chores created but never completed", () => {
    const reasons = buildRiskReasons({
      choresCreatedRecent: 5,
      choresCompletedRecent: 0,
      daysSinceParentActivity: 0,
      daysSinceChildActivity: 8,
      daysSinceLastActivity: 0,
      totalEventsRecent: 5,
    });
    expect(reasons).toContain("Chores were created but none are being completed.");
  });

  it("flags slow approvals in plain language", () => {
    const reasons = buildRiskReasons({
      avgApprovalHours: 72,
      daysSinceLastActivity: 1,
      totalEventsRecent: 4,
    });
    expect(reasons.some((reason) => reason.includes("Approvals are slow"))).toBe(true);
  });
});
