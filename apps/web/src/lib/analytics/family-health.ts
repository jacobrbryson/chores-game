// Family Health Model (V1).
//
// Turns a family's recent analytics signals into a single Healthy / At Risk /
// Inactive state plus a 0–100 score and plain-language risk reasons. This module
// is intentionally PURE: it takes already-aggregated inputs and returns a signal.
// All Firestore reading / event aggregation lives in ./family-health-query.ts so
// the classifier stays trivially unit-testable and can be recalculated on demand
// without touching the data layer.
//
// The score is a weighted blend of four buckets that mirror the core family loop:
//   Parent Activity  (30) — is a parent showing up and clearing approvals?
//   Child Activity   (30) — are kids completing chores?
//   Core Loop Health (25) — do completions get approved promptly, backlog low?
//   Engagement Depth (15) — store / XP / titles / Athena usage (stickiness)
// Buckets are scored 0..1 from the available signals, then weighted to 100. Every
// input is optional so the model degrades gracefully as instrumentation lands —
// a missing signal is treated as neutral/absent rather than crashing the score.

export type FamilyHealthState = "healthy" | "at_risk" | "inactive";

// The trailing window the aggregation uses for "recent" counts and recency. Kept
// here so the classifier and the query layer agree on what "recent" means.
export const FAMILY_HEALTH_WINDOW_DAYS = 7;

// Classification thresholds. Exposed (and overridable) so operators can re-tune
// the Healthy / At Risk / Inactive cutoffs later without a code change.
export type FamilyHealthThresholds = {
  // Score at or above this is Healthy.
  healthyMin: number;
  // Score at or above this (but below healthyMin) is At Risk; below it is Inactive.
  atRiskMin: number;
};

export const DEFAULT_FAMILY_HEALTH_THRESHOLDS: FamilyHealthThresholds = {
  healthyMin: 80,
  atRiskMin: 40,
};

// Tuning constants for the sub-signals. Grouped so the knobs are discoverable.
export const FAMILY_HEALTH_TUNING = {
  // Days of parent inactivity that drives the parent recency score to 0.
  parentInactiveDays: 10,
  // Days of child inactivity that drives the child recency score to 0.
  childInactiveDays: 7,
  // Distinct recent actions that saturate an "actions" sub-score.
  actionsSaturation: 5,
  // Backlog size at which the backlog sub-score hits 0.
  backlogHigh: 12,
  // Average approval latency (hours) at which the timeliness sub-score hits 0.
  approvalSlowHours: 48,
  // Engagement-depth events that saturate the depth bucket.
  depthSaturation: 8,
  // Days with no family activity at all that mark a family clearly inactive.
  inactiveDays: 7,
} as const;

// Aggregated, already-computed signals for a single family over the trailing
// window. `null` means "unknown / not applicable" (e.g. never active, or no
// approvals to time), which the classifier treats differently from `0`.
export type FamilyHealthInputs = {
  // Days since the most recent parent/admin event (null = no parent activity seen).
  daysSinceParentActivity?: number | null;
  // Days since the most recent child/player event (null = no child activity seen).
  daysSinceChildActivity?: number | null;
  // Days since ANY family member did anything (null = no activity at all).
  daysSinceLastActivity?: number | null;

  // Parent-side actions in the window.
  choresCreatedRecent?: number;
  choresApprovedRecent?: number;
  approvalInboxOpenedRecent?: number;

  // Child-side actions in the window.
  choresCompletedRecent?: number;
  seeAndDoCreatedRecent?: number;

  // Core-loop health.
  approvalBacklog?: number;
  avgApprovalHours?: number | null;
  routineCompletionRate?: number | null; // 0..1

  // Engagement depth (stickiness) counts in the window.
  storePurchasesRecent?: number;
  pillarXpEarnedRecent?: number;
  identityProgressRecent?: number;
  questActivityRecent?: number;
  athenaUsageRecent?: number;

  // Total events for the family in the window — used to detect "no signal at all".
  totalEventsRecent?: number;
};

export type FamilyHealthBreakdown = {
  parentActivity: number; // 0..1
  childActivity: number; // 0..1
  coreLoop: number; // 0..1
  engagementDepth: number; // 0..1
};

export type FamilyHealthSignal = {
  score: number; // 0..100
  state: FamilyHealthState;
  // True now that V1 ships a real model. Kept on the shape so accidental callers
  // of any future stub can still tell a real assessment from a placeholder.
  computed: boolean;
  // Plain-language reasons explaining an At Risk / Inactive state (empty when Healthy).
  reasons: string[];
  breakdown: FamilyHealthBreakdown;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

// Recency score: 1.0 when active today, decaying to 0 at `inactiveDays`. A null
// timestamp (never active) scores 0.
function recencyScore(daysSince: number | null | undefined, inactiveDays: number): number {
  if (daysSince === null || daysSince === undefined) return 0;
  return clamp01(1 - daysSince / inactiveDays);
}

// Saturating count score: 0 actions → 0, `saturation` actions → 1.
function countScore(count: number | undefined, saturation: number): number {
  return clamp01((count ?? 0) / Math.max(1, saturation));
}

/**
 * Score a family's health from aggregated signals. Pure and deterministic.
 */
export function scoreFamilyHealth(
  inputs: FamilyHealthInputs = {},
  thresholds: FamilyHealthThresholds = DEFAULT_FAMILY_HEALTH_THRESHOLDS,
): FamilyHealthSignal {
  const t = FAMILY_HEALTH_TUNING;

  // --- Parent Activity (30) ---
  const parentRecency = recencyScore(inputs.daysSinceParentActivity, t.parentInactiveDays);
  const parentActions = countScore(
    (inputs.choresApprovedRecent ?? 0) +
      (inputs.choresCreatedRecent ?? 0) +
      (inputs.approvalInboxOpenedRecent ?? 0),
    t.actionsSaturation,
  );
  const parentActivity = clamp01(0.6 * parentRecency + 0.4 * parentActions);

  // --- Child Activity (30) ---
  const childRecency = recencyScore(inputs.daysSinceChildActivity, t.childInactiveDays);
  const childActions = countScore(
    (inputs.choresCompletedRecent ?? 0) + (inputs.seeAndDoCreatedRecent ?? 0),
    t.actionsSaturation,
  );
  const childActivity = clamp01(0.6 * childRecency + 0.4 * childActions);

  // --- Core Loop Health (25) --- average of whatever sub-signals are present.
  // Crucially, an empty backlog only counts as "healthy" when the loop is
  // actually turning; a dead family with no completions and no backlog must NOT
  // get credit for having nothing queued.
  const completions = inputs.choresCompletedRecent ?? 0;
  const approvals = inputs.choresApprovedRecent ?? 0;
  const backlog = inputs.approvalBacklog ?? 0;
  const loopParts: number[] = [];
  // Throughput: were completions happening at all?
  if (completions > 0 || approvals > 0) {
    loopParts.push(countScore(completions, t.actionsSaturation));
  }
  // Backlog penalty — only meaningful once something is in (or could be in) flight.
  if (backlog > 0 || completions > 0 || approvals > 0) {
    loopParts.push(clamp01(1 - backlog / t.backlogHigh));
  }
  // Approval timeliness, only when we actually timed some approvals.
  if (inputs.avgApprovalHours !== null && inputs.avgApprovalHours !== undefined) {
    loopParts.push(clamp01(1 - inputs.avgApprovalHours / t.approvalSlowHours));
  }
  // Routine completion rate, when known.
  if (inputs.routineCompletionRate !== null && inputs.routineCompletionRate !== undefined) {
    loopParts.push(clamp01(inputs.routineCompletionRate));
  }
  const coreLoop = loopParts.length
    ? clamp01(loopParts.reduce((sum, value) => sum + value, 0) / loopParts.length)
    : 0;

  // --- Engagement Depth (15) ---
  const depthCount =
    (inputs.storePurchasesRecent ?? 0) +
    (inputs.pillarXpEarnedRecent ?? 0) +
    (inputs.identityProgressRecent ?? 0) +
    (inputs.questActivityRecent ?? 0) +
    (inputs.athenaUsageRecent ?? 0);
  const engagementDepth = countScore(depthCount, t.depthSaturation);

  const breakdown: FamilyHealthBreakdown = {
    parentActivity,
    childActivity,
    coreLoop,
    engagementDepth,
  };

  const score = Math.round(
    30 * parentActivity + 30 * childActivity + 25 * coreLoop + 15 * engagementDepth,
  );

  // A family with no events at all in the window is Inactive regardless of score.
  const noRecentSignal =
    (inputs.totalEventsRecent ?? 0) === 0 &&
    (inputs.daysSinceLastActivity === null || inputs.daysSinceLastActivity === undefined);

  let state: FamilyHealthState;
  if (noRecentSignal || score < thresholds.atRiskMin) {
    state = "inactive";
  } else if (score < thresholds.healthyMin) {
    state = "at_risk";
  } else {
    state = "healthy";
  }
  // Override: even a decent score is "at risk" rather than "inactive" if there is
  // still some recent signal; keep "inactive" reserved for genuinely dark families.
  if (state === "inactive" && !noRecentSignal && score >= thresholds.atRiskMin) {
    state = "at_risk";
  }

  return {
    score,
    state,
    computed: true,
    reasons: state === "healthy" ? [] : buildRiskReasons(inputs),
    breakdown,
  };
}

/**
 * Human-readable risk reasons, ordered most-severe first. Used by the support
 * dashboard so an operator sees *why* a family is flagged, not just a number.
 */
export function buildRiskReasons(inputs: FamilyHealthInputs): string[] {
  const reasons: string[] = [];
  const t = FAMILY_HEALTH_TUNING;

  const parentDays = inputs.daysSinceParentActivity;
  const childDays = inputs.daysSinceChildActivity;
  const lastDays = inputs.daysSinceLastActivity;

  if (lastDays === null || lastDays === undefined) {
    if ((inputs.totalEventsRecent ?? 0) === 0) {
      reasons.push("No meaningful activity in the last 7+ days.");
    }
  } else if (lastDays >= t.inactiveDays) {
    reasons.push(`No family activity in ${Math.floor(lastDays)} days.`);
  }

  if (parentDays === null || parentDays === undefined) {
    reasons.push("No parent activity recorded.");
  } else if (parentDays >= 3) {
    reasons.push(`Parent has not been active in ${Math.floor(parentDays)} days.`);
  }

  if (childDays === null || childDays === undefined) {
    reasons.push("No child activity recorded.");
  } else if (childDays >= 3) {
    reasons.push(`No child activity in ${Math.floor(childDays)} days.`);
  }

  const backlog = inputs.approvalBacklog ?? 0;
  if (backlog >= 5) {
    reasons.push(`${backlog} chores are waiting for approval.`);
  }

  if (
    inputs.avgApprovalHours !== null &&
    inputs.avgApprovalHours !== undefined &&
    inputs.avgApprovalHours >= t.approvalSlowHours
  ) {
    const days = Math.round(inputs.avgApprovalHours / 24);
    reasons.push(`Approvals are slow — about ${days} day${days === 1 ? "" : "s"} on average.`);
  }

  // Children doing work that parents aren't acknowledging.
  if ((inputs.choresCompletedRecent ?? 0) > 0 && backlog > 0 && (inputs.choresApprovedRecent ?? 0) === 0) {
    reasons.push("Children completed chores but did not receive rewards.");
  }

  // Parents setting up work that isn't getting done.
  if ((inputs.choresCreatedRecent ?? 0) > 0 && (inputs.choresCompletedRecent ?? 0) === 0) {
    reasons.push("Chores were created but none are being completed.");
  }

  if (
    inputs.routineCompletionRate !== null &&
    inputs.routineCompletionRate !== undefined &&
    inputs.routineCompletionRate < 0.25
  ) {
    reasons.push("Routines were created but are not being completed.");
  }

  return reasons;
}

/**
 * Backward-compatible entry point. Earlier code referenced evaluateFamilyHealth;
 * it now delegates to the real scorer.
 */
export function evaluateFamilyHealth(
  inputs: FamilyHealthInputs = {},
  thresholds: FamilyHealthThresholds = DEFAULT_FAMILY_HEALTH_THRESHOLDS,
): FamilyHealthSignal {
  return scoreFamilyHealth(inputs, thresholds);
}
