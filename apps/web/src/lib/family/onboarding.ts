// Onboarding routing decision logic, extracted as a pure function so it can be
// unit-tested and reused by both the /api/family/onboarding-status route and any
// server-side guard.
//
// Background (P0 bug, 2026-06): existing families that pre-dated consent-version
// tracking had neither `onboardingCompletedAt` nor `parentalConsentAt` set. The
// old rule `needsOnboarding = !(onboardingCompletedAt || parentalConsentAt)`
// therefore sent those families — children and all — back through the full
// new-family onboarding wizard, whose "Add First Child" step created duplicate
// child profiles. The decisive fix: a family that already has children must NEVER
// be routed into onboarding. Consent acceptance only records consent; it must not
// reset onboarding/family/children state.

export type OnboardingRedirectTarget = "family_setup" | "child_setup" | "dashboard";

export type OnboardingDecisionInput = {
  hasFamily: boolean;
  viewerRole: "admin" | "player";
  /** Count of active (non-deleted) child/player members in the family. */
  childCount: number;
  onboardingCompletedAt: string | null;
  parentalConsentAt: string | null;
  acceptedTermsVersion: string;
  acceptedPrivacyVersion: string;
  currentTermsVersion: string;
  currentPrivacyVersion: string;
  /** True when the family is soft-deleted or has a pending deletion request. */
  deletedOrDeletionRequested: boolean;
};

export type OnboardingDecision = {
  redirectTarget: OnboardingRedirectTarget;
  needsOnboarding: boolean;
  needsReacceptance: boolean;
  hasPreviousVersionedConsent: boolean;
};

export function computeOnboardingDecision(input: OnboardingDecisionInput): OnboardingDecision {
  const {
    hasFamily,
    viewerRole,
    childCount,
    onboardingCompletedAt,
    parentalConsentAt,
    acceptedTermsVersion,
    acceptedPrivacyVersion,
    currentTermsVersion,
    currentPrivacyVersion,
    deletedOrDeletionRequested,
  } = input;

  const hasPreviousVersionedConsent = Boolean(acceptedTermsVersion);

  // Players never onboard or re-accept — that is always an admin (parent) action.
  if (viewerRole !== "admin") {
    return {
      redirectTarget: "dashboard",
      needsOnboarding: false,
      needsReacceptance: false,
      hasPreviousVersionedConsent,
    };
  }

  // Families pending deletion or already deleted are left alone.
  if (deletedOrDeletionRequested) {
    return {
      redirectTarget: "dashboard",
      needsOnboarding: false,
      needsReacceptance: false,
      hasPreviousVersionedConsent,
    };
  }

  // No family yet → the only thing they can do is create one.
  if (!hasFamily) {
    return {
      redirectTarget: "family_setup",
      needsOnboarding: true,
      needsReacceptance: false,
      hasPreviousVersionedConsent,
    };
  }

  const hasChildren = childCount > 0;
  const hasCompletedOnboarding = Boolean(onboardingCompletedAt || parentalConsentAt);
  const consentUpToDate =
    Boolean(parentalConsentAt) &&
    acceptedTermsVersion === currentTermsVersion &&
    acceptedPrivacyVersion === currentPrivacyVersion;

  // Structural redirect target (matches product spec):
  //   no family        → family setup
  //   family, 0 kids   → child setup
  //   family, has kids → dashboard
  const redirectTarget: OnboardingRedirectTarget = hasChildren ? "dashboard" : "child_setup";

  // THE FIX: a family that already has children is fully set up. It must never be
  // dropped back into the new-family onboarding wizard (which would let the
  // "first child" step mint a duplicate). Such families only ever see the
  // lightweight re-acceptance modal when their consent version is stale.
  if (hasChildren) {
    return {
      redirectTarget,
      needsOnboarding: false,
      needsReacceptance: !consentUpToDate,
      hasPreviousVersionedConsent,
    };
  }

  // Family exists but has no children. Only send them into the wizard if they
  // have never completed onboarding; a family that finished onboarding earlier
  // (and simply has no children right now) is not trapped in the wizard.
  return {
    redirectTarget,
    needsOnboarding: !hasCompletedOnboarding,
    needsReacceptance: hasCompletedOnboarding ? !consentUpToDate : false,
    hasPreviousVersionedConsent,
  };
}

// Shared guard used by the family-member creation route. Returns true when an
// onboarding "first child" request must be rejected because the family already
// has children — i.e. the caller was wrongly routed into onboarding (the P0 bug)
// and is about to create a duplicate. Regular family-management adds (a different
// source) and legitimate first children (0 existing) are never blocked.
export function shouldBlockOnboardingFirstChild(input: {
  source: string | undefined;
  onboardingFirstChild: boolean;
  existingChildCount: number;
}): boolean {
  return (
    input.source === "onboarding" &&
    input.onboardingFirstChild === true &&
    input.existingChildCount > 0
  );
}
