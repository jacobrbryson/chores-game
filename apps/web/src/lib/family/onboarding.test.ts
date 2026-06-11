import { describe, expect, it } from "vitest";
import {
  computeOnboardingDecision,
  shouldBlockOnboardingFirstChild,
  type OnboardingDecisionInput,
} from "@/lib/family/onboarding";

const CURRENT_TERMS = "2026-06-06";
const CURRENT_PRIVACY = "2026-06-06";

function baseInput(overrides: Partial<OnboardingDecisionInput> = {}): OnboardingDecisionInput {
  return {
    hasFamily: true,
    viewerRole: "admin",
    childCount: 0,
    onboardingCompletedAt: null,
    parentalConsentAt: null,
    acceptedTermsVersion: "",
    acceptedPrivacyVersion: "",
    currentTermsVersion: CURRENT_TERMS,
    currentPrivacyVersion: CURRENT_PRIVACY,
    deletedOrDeletionRequested: false,
    ...overrides,
  };
}

describe("computeOnboardingDecision", () => {
  it("sends an existing family WITH children to the dashboard (never re-onboards) — the P0 fix", () => {
    // Pre-wizard family: has children but no onboardingCompletedAt and no
    // parentalConsentAt. The old logic re-onboarded them and created duplicates.
    const decision = computeOnboardingDecision(
      baseInput({ childCount: 2, onboardingCompletedAt: null, parentalConsentAt: null }),
    );
    expect(decision.needsOnboarding).toBe(false);
    expect(decision.redirectTarget).toBe("dashboard");
  });

  it("an existing family WITH children only re-accepts when consent is stale", () => {
    const stale = computeOnboardingDecision(
      baseInput({
        childCount: 1,
        parentalConsentAt: "2025-01-01T00:00:00Z",
        acceptedTermsVersion: "2024-01-01",
        acceptedPrivacyVersion: "2024-01-01",
      }),
    );
    expect(stale.needsOnboarding).toBe(false);
    expect(stale.needsReacceptance).toBe(true);

    const current = computeOnboardingDecision(
      baseInput({
        childCount: 1,
        parentalConsentAt: "2026-06-06T00:00:00Z",
        acceptedTermsVersion: CURRENT_TERMS,
        acceptedPrivacyVersion: CURRENT_PRIVACY,
      }),
    );
    expect(current.needsReacceptance).toBe(false);
    expect(current.redirectTarget).toBe("dashboard");
  });

  it("sends an existing family with NO children to child setup", () => {
    const decision = computeOnboardingDecision(baseInput({ childCount: 0 }));
    expect(decision.redirectTarget).toBe("child_setup");
    expect(decision.needsOnboarding).toBe(true);
  });

  it("does not trap a childless family that already completed onboarding in the wizard", () => {
    const decision = computeOnboardingDecision(
      baseInput({
        childCount: 0,
        onboardingCompletedAt: "2026-01-01T00:00:00Z",
        parentalConsentAt: "2026-01-01T00:00:00Z",
        acceptedTermsVersion: CURRENT_TERMS,
        acceptedPrivacyVersion: CURRENT_PRIVACY,
      }),
    );
    expect(decision.needsOnboarding).toBe(false);
    expect(decision.redirectTarget).toBe("child_setup");
  });

  it("sends a new user with no family to family setup", () => {
    const decision = computeOnboardingDecision(baseInput({ hasFamily: false }));
    expect(decision.redirectTarget).toBe("family_setup");
    expect(decision.needsOnboarding).toBe(true);
  });

  it("recording consent (TOS acceptance) does not reset onboarding for a family with children", () => {
    // Simulate state immediately after consent: versions + parentalConsentAt set,
    // children intact. Onboarding must stay complete.
    const decision = computeOnboardingDecision(
      baseInput({
        childCount: 3,
        parentalConsentAt: new Date().toISOString(),
        acceptedTermsVersion: CURRENT_TERMS,
        acceptedPrivacyVersion: CURRENT_PRIVACY,
      }),
    );
    expect(decision.needsOnboarding).toBe(false);
    expect(decision.needsReacceptance).toBe(false);
    expect(decision.redirectTarget).toBe("dashboard");
  });

  it("never onboards a player (child) viewer", () => {
    const decision = computeOnboardingDecision(
      baseInput({ viewerRole: "player", childCount: 0 }),
    );
    expect(decision.needsOnboarding).toBe(false);
    expect(decision.redirectTarget).toBe("dashboard");
  });

  it("leaves families pending deletion alone", () => {
    const decision = computeOnboardingDecision(
      baseInput({ childCount: 0, deletedOrDeletionRequested: true }),
    );
    expect(decision.needsOnboarding).toBe(false);
    expect(decision.needsReacceptance).toBe(false);
  });
});

describe("shouldBlockOnboardingFirstChild", () => {
  it("blocks a first onboarding child when the family already has children", () => {
    expect(
      shouldBlockOnboardingFirstChild({
        source: "onboarding",
        onboardingFirstChild: true,
        existingChildCount: 1,
      }),
    ).toBe(true);
  });

  it("allows the first onboarding child for a genuinely empty family", () => {
    expect(
      shouldBlockOnboardingFirstChild({
        source: "onboarding",
        onboardingFirstChild: true,
        existingChildCount: 0,
      }),
    ).toBe(false);
  });

  it("allows additional onboarding children added in the same session", () => {
    // After the first add, onboardingFirstChild is false; subsequent adds are fine.
    expect(
      shouldBlockOnboardingFirstChild({
        source: "onboarding",
        onboardingFirstChild: false,
        existingChildCount: 1,
      }),
    ).toBe(false);
  });

  it("never blocks regular family-management adds even when children exist", () => {
    expect(
      shouldBlockOnboardingFirstChild({
        source: "family_management",
        onboardingFirstChild: false,
        existingChildCount: 5,
      }),
    ).toBe(false);
    expect(
      shouldBlockOnboardingFirstChild({
        source: undefined,
        onboardingFirstChild: true,
        existingChildCount: 5,
      }),
    ).toBe(false);
  });
});
