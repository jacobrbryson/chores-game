// Family Health aggregation layer.
//
// Reads the centralized analytics event store (plus the chores collection for the
// live approval backlog) via admin/service-account credentials and turns it into
// per-family health rows using the pure classifier in ./family-health.ts. This is
// the ONLY place that touches Firestore for health — the classifier stays pure
// and the support route just calls these functions, so the score is fully
// recalculatable on demand.
//
// Cost note: the overview does a single bounded, newest-first scan of the event
// store and aggregates in memory (same pattern as ./query.ts and the
// observability layer) rather than per-family queries, so page load stays cheap.
// The drill-down fetches one family's events with an equality filter.

import { adminGetDocument, adminListAllDocuments, adminRunQuery } from "@/lib/firestore/admin";
import {
  documentIdFromName,
  readBoolean,
  readString,
  type FirestoreDocument,
} from "@/lib/firestore/rest";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { ANALYTICS_EVENTS_COLLECTION, type AnalyticsEvent } from "@/lib/analytics/service";
import { normalizeAnalyticsEvent } from "@/lib/analytics/query";
import {
  DEFAULT_FAMILY_HEALTH_THRESHOLDS,
  FAMILY_HEALTH_WINDOW_DAYS,
  scoreFamilyHealth,
  type FamilyHealthInputs,
  type FamilyHealthState,
  type FamilyHealthThresholds,
} from "@/lib/analytics/family-health";

// Bounded scan caps. Disclosed in the response so operators know whether the
// numbers are exact or a recent-window sample.
export const FAMILY_HEALTH_EVENT_SCAN_CAP = 8000;
const FAMILY_LIST_CAP = 2000;
const CHORE_SCAN_CAP = 8000;
const DETAIL_EVENT_CAP = 1500;
const DETAIL_RECENT_EVENTS = 40;

const DAY_MS = 24 * 60 * 60 * 1000;
const PARENT_ROLE = "admin";
const CHILD_ROLE = "player";

export type FamilyHealthRow = {
  familyId: string;
  familyName: string;
  state: FamilyHealthState;
  score: number;
  reasons: string[];
  lastParentActivity: string | null;
  lastChildActivity: string | null;
  lastActivity: string | null;
  pendingApprovals: number;
  choresCompletedThisWeek: number;
  avgApprovalHours: number | null;
  totalEventsRecent: number;
};

export type FamilyHealthOverview = {
  generatedAt: string;
  windowDays: number;
  thresholds: FamilyHealthThresholds;
  scannedEvents: number;
  eventScanCap: number;
  capped: boolean;
  totals: {
    families: number;
    healthy: number;
    atRisk: number;
    inactive: number;
    unknown: number;
  };
  families: FamilyHealthRow[];
};

// Mutable per-family accumulator while sweeping the event stream once.
type Accumulator = {
  lastParentMillis: number | null;
  lastChildMillis: number | null;
  lastAnyMillis: number | null;
  totalEventsRecent: number;
  choresCompletedRecent: number;
  choresApprovedRecent: number;
  choresCreatedRecent: number;
  approvalInboxOpenedRecent: number;
  seeAndDoCreatedRecent: number;
  routineCompletedRecent: number;
  routineCreatedRecent: number;
  storePurchasesRecent: number;
  pillarXpEarnedRecent: number;
  identityProgressRecent: number;
  athenaUsageRecent: number;
  // choreId -> completion timestamp (only chores that needed approval).
  completedAtByChore: Map<string, number>;
  // choreId -> approval timestamp.
  approvedAtByChore: Map<string, number>;
};

function newAccumulator(): Accumulator {
  return {
    lastParentMillis: null,
    lastChildMillis: null,
    lastAnyMillis: null,
    totalEventsRecent: 0,
    choresCompletedRecent: 0,
    choresApprovedRecent: 0,
    choresCreatedRecent: 0,
    approvalInboxOpenedRecent: 0,
    seeAndDoCreatedRecent: 0,
    routineCompletedRecent: 0,
    routineCreatedRecent: 0,
    storePurchasesRecent: 0,
    pillarXpEarnedRecent: 0,
    identityProgressRecent: 0,
    athenaUsageRecent: 0,
    completedAtByChore: new Map(),
    approvedAtByChore: new Map(),
  };
}

function maxMillis(current: number | null, candidate: number): number {
  return current === null ? candidate : Math.max(current, candidate);
}

function daysSince(millis: number | null, now: number): number | null {
  if (millis === null) return null;
  return Math.max(0, (now - millis) / DAY_MS);
}

function toIso(millis: number | null): string | null {
  return millis === null ? null : new Date(millis).toISOString();
}

// Fold a single event into its family accumulator.
function applyEvent(acc: Accumulator, event: AnalyticsEvent, windowCutoff: number): void {
  const millis = Date.parse(event.timestamp);
  if (!Number.isFinite(millis)) return;

  acc.lastAnyMillis = maxMillis(acc.lastAnyMillis, millis);
  if (event.role === PARENT_ROLE) {
    acc.lastParentMillis = maxMillis(acc.lastParentMillis, millis);
  } else if (event.role === CHILD_ROLE) {
    acc.lastChildMillis = maxMillis(acc.lastChildMillis, millis);
  }

  const choreId = typeof event.metadata?.choreId === "string" ? event.metadata.choreId : "";

  // Approval-latency pairing spans the full scan (not just the window) so we can
  // time approvals whose completion happened slightly earlier.
  if (event.event === ANALYTICS_EVENTS.chore_completed && choreId) {
    if (event.metadata?.requireApproval === true) {
      acc.completedAtByChore.set(choreId, millis);
    }
  } else if (event.event === ANALYTICS_EVENTS.chore_approved && choreId) {
    acc.approvedAtByChore.set(choreId, millis);
  }

  if (millis < windowCutoff) return;
  acc.totalEventsRecent += 1;

  switch (event.event) {
    case ANALYTICS_EVENTS.chore_completed:
      acc.choresCompletedRecent += 1;
      break;
    case ANALYTICS_EVENTS.chore_approved:
      acc.choresApprovedRecent += 1;
      break;
    case ANALYTICS_EVENTS.chore_created:
      acc.choresCreatedRecent += 1;
      break;
    case ANALYTICS_EVENTS.see_and_do_created:
      acc.seeAndDoCreatedRecent += 1;
      break;
    case ANALYTICS_EVENTS.routine_completed:
      acc.routineCompletedRecent += 1;
      break;
    case ANALYTICS_EVENTS.routine_created:
      acc.routineCreatedRecent += 1;
      break;
    case ANALYTICS_EVENTS.approval_inbox_opened:
    case ANALYTICS_EVENTS.approval_approved:
    case ANALYTICS_EVENTS.approval_approve_all:
    case ANALYTICS_EVENTS.approval_alert_clicked:
      acc.approvalInboxOpenedRecent += 1;
      break;
    case ANALYTICS_EVENTS.store_item_purchased:
    case ANALYTICS_EVENTS.reward_redeemed:
    case ANALYTICS_EVENTS.coins_spent:
      acc.storePurchasesRecent += 1;
      break;
    case ANALYTICS_EVENTS.pillar_xp_earned:
    case ANALYTICS_EVENTS.pillar_level_up:
      acc.pillarXpEarnedRecent += 1;
      break;
    case ANALYTICS_EVENTS.identity_title_unlocked:
    case ANALYTICS_EVENTS.identity_progress_viewed:
      acc.identityProgressRecent += 1;
      break;
    case ANALYTICS_EVENTS.athena_session_started:
    case ANALYTICS_EVENTS.athena_message_sent:
    case ANALYTICS_EVENTS.athena_suggestion_generated:
    case ANALYTICS_EVENTS.athena_suggestion_accepted:
    case ANALYTICS_EVENTS.athena_suggestion_completed:
      acc.athenaUsageRecent += 1;
      break;
    default:
      break;
  }
}

// Average hours between completion and approval for chores approved within the
// window. Returns null when there is nothing to time.
function computeAvgApprovalHours(acc: Accumulator, windowCutoff: number): number | null {
  let total = 0;
  let count = 0;
  for (const [choreId, approvedAt] of acc.approvedAtByChore) {
    if (approvedAt < windowCutoff) continue;
    const completedAt = acc.completedAtByChore.get(choreId);
    if (completedAt === undefined || approvedAt < completedAt) continue;
    total += (approvedAt - completedAt) / (60 * 60 * 1000);
    count += 1;
  }
  return count === 0 ? null : total / count;
}

function accumulatorToInputs(
  acc: Accumulator,
  pendingApprovals: number,
  now: number,
  windowCutoff: number,
): FamilyHealthInputs {
  const routineCompletionRate =
    acc.routineCreatedRecent > 0
      ? Math.min(1, acc.routineCompletedRecent / acc.routineCreatedRecent)
      : null;
  return {
    daysSinceParentActivity: daysSince(acc.lastParentMillis, now),
    daysSinceChildActivity: daysSince(acc.lastChildMillis, now),
    daysSinceLastActivity: daysSince(acc.lastAnyMillis, now),
    choresCreatedRecent: acc.choresCreatedRecent,
    choresApprovedRecent: acc.choresApprovedRecent,
    approvalInboxOpenedRecent: acc.approvalInboxOpenedRecent,
    choresCompletedRecent: acc.choresCompletedRecent,
    seeAndDoCreatedRecent: acc.seeAndDoCreatedRecent,
    approvalBacklog: pendingApprovals,
    avgApprovalHours: computeAvgApprovalHours(acc, windowCutoff),
    routineCompletionRate,
    storePurchasesRecent: acc.storePurchasesRecent,
    pillarXpEarnedRecent: acc.pillarXpEarnedRecent,
    identityProgressRecent: acc.identityProgressRecent,
    athenaUsageRecent: acc.athenaUsageRecent,
    totalEventsRecent: acc.totalEventsRecent,
  };
}

function familyIdFromDocName(name: string): string {
  const match = name.match(/\/families\/([^/]+)/);
  return match?.[1] ?? "";
}

// Current approval backlog per family: chores in the "Submitted" (awaiting
// approval) state that haven't been deleted. Keyed by familyId.
function buildBacklogByFamily(choreDocs: FirestoreDocument[]): Map<string, number> {
  const backlog = new Map<string, number>();
  for (const doc of choreDocs) {
    if (readBoolean(doc.fields, "deleted")) continue;
    if (readString(doc.fields, "status") !== "Submitted") continue;
    const familyId = familyIdFromDocName(doc.name);
    if (!familyId) continue;
    backlog.set(familyId, (backlog.get(familyId) ?? 0) + 1);
  }
  return backlog;
}

const STATE_RANK: Record<FamilyHealthState, number> = {
  inactive: 0,
  at_risk: 1,
  healthy: 2,
};

/**
 * Compute the cross-family health overview from a single bounded event scan.
 * Worst-first ordering so operators see families needing help at the top.
 */
export async function loadFamilyHealthOverview(
  thresholds: FamilyHealthThresholds = DEFAULT_FAMILY_HEALTH_THRESHOLDS,
  now: Date = new Date(),
): Promise<FamilyHealthOverview> {
  const [eventDocs, familyDocs, choreDocs] = await Promise.all([
    adminRunQuery({
      from: [{ collectionId: ANALYTICS_EVENTS_COLLECTION }],
      orderBy: [{ field: { fieldPath: "createdAt" }, direction: "DESCENDING" }],
      limit: FAMILY_HEALTH_EVENT_SCAN_CAP,
    }),
    adminListAllDocuments("families", { cap: FAMILY_LIST_CAP }),
    adminRunQuery({
      from: [{ collectionId: "chores", allDescendants: true }],
      limit: CHORE_SCAN_CAP,
    }),
  ]);

  const nowMillis = now.getTime();
  const windowCutoff = nowMillis - FAMILY_HEALTH_WINDOW_DAYS * DAY_MS;

  const nameByFamily = new Map<string, string>();
  for (const doc of familyDocs) {
    nameByFamily.set(documentIdFromName(doc.name), readString(doc.fields, "name") || "Family");
  }

  const backlogByFamily = buildBacklogByFamily(choreDocs);

  const accByFamily = new Map<string, Accumulator>();
  for (const doc of eventDocs) {
    const event = normalizeAnalyticsEvent(doc);
    if (!event.familyId) continue;
    let acc = accByFamily.get(event.familyId);
    if (!acc) {
      acc = newAccumulator();
      accByFamily.set(event.familyId, acc);
    }
    applyEvent(acc, event, windowCutoff);
  }

  // Every known family gets a row, even ones with zero events (Inactive). Union
  // the family list with families seen in the event/backlog streams.
  const familyIds = new Set<string>([
    ...nameByFamily.keys(),
    ...accByFamily.keys(),
    ...backlogByFamily.keys(),
  ]);

  const rows: FamilyHealthRow[] = [];
  for (const familyId of familyIds) {
    const acc = accByFamily.get(familyId) ?? newAccumulator();
    const pendingApprovals = backlogByFamily.get(familyId) ?? 0;
    const inputs = accumulatorToInputs(acc, pendingApprovals, nowMillis, windowCutoff);
    const signal = scoreFamilyHealth(inputs, thresholds);
    rows.push({
      familyId,
      familyName: nameByFamily.get(familyId) ?? "Unknown family",
      state: signal.state,
      score: signal.score,
      reasons: signal.reasons,
      lastParentActivity: toIso(acc.lastParentMillis),
      lastChildActivity: toIso(acc.lastChildMillis),
      lastActivity: toIso(acc.lastAnyMillis),
      pendingApprovals,
      choresCompletedThisWeek: acc.choresCompletedRecent,
      avgApprovalHours: inputs.avgApprovalHours ?? null,
      totalEventsRecent: acc.totalEventsRecent,
    });
  }

  rows.sort((a, b) => {
    if (STATE_RANK[a.state] !== STATE_RANK[b.state]) {
      return STATE_RANK[a.state] - STATE_RANK[b.state];
    }
    return a.score - b.score;
  });

  const totals = {
    families: rows.length,
    healthy: rows.filter((row) => row.state === "healthy").length,
    atRisk: rows.filter((row) => row.state === "at_risk").length,
    inactive: rows.filter((row) => row.state === "inactive").length,
    unknown: 0,
  };

  return {
    generatedAt: now.toISOString(),
    windowDays: FAMILY_HEALTH_WINDOW_DAYS,
    thresholds,
    scannedEvents: eventDocs.length,
    eventScanCap: FAMILY_HEALTH_EVENT_SCAN_CAP,
    capped: eventDocs.length >= FAMILY_HEALTH_EVENT_SCAN_CAP,
    totals,
    families: rows,
  };
}

export type FamilyHealthDetail = {
  familyId: string;
  familyName: string;
  generatedAt: string;
  windowDays: number;
  score: number;
  state: FamilyHealthState;
  reasons: string[];
  breakdown: ReturnType<typeof scoreFamilyHealth>["breakdown"];
  inputs: FamilyHealthInputs;
  pendingApprovals: number;
  // Completions per day across the trailing window, oldest day first.
  completionTrend: Array<{ date: string; completed: number; approved: number }>;
  parentActivity: { lastActive: string | null; eventsInWindow: number };
  childActivity: { lastActive: string | null; eventsInWindow: number };
  routineActivity: { created: number; completed: number };
  responsibilityXpEvents: number;
  recentEvents: AnalyticsEvent[];
};

/**
 * Per-family drill-down. Fetches just this family's events (equality filter, no
 * composite index needed) plus its chores subcollection for the live backlog.
 */
export async function loadFamilyHealthDetail(
  familyId: string,
  thresholds: FamilyHealthThresholds = DEFAULT_FAMILY_HEALTH_THRESHOLDS,
  now: Date = new Date(),
): Promise<FamilyHealthDetail> {
  const [eventDocs, choreDocs, familyDoc] = await Promise.all([
    adminRunQuery({
      from: [{ collectionId: ANALYTICS_EVENTS_COLLECTION }],
      where: {
        fieldFilter: {
          field: { fieldPath: "familyId" },
          op: "EQUAL",
          value: { stringValue: familyId },
        },
      },
      limit: DETAIL_EVENT_CAP,
    }),
    adminListAllDocuments(`families/${familyId}/chores`, { cap: CHORE_SCAN_CAP }).catch(() => []),
    adminGetDocument(`families/${familyId}`).catch(() => null),
  ]);

  const nowMillis = now.getTime();
  const windowCutoff = nowMillis - FAMILY_HEALTH_WINDOW_DAYS * DAY_MS;

  const events = eventDocs
    .map(normalizeAnalyticsEvent)
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

  const acc = newAccumulator();
  for (const event of events) {
    applyEvent(acc, event, windowCutoff);
  }

  const pendingApprovals = buildBacklogByFamily(choreDocs).get(familyId) ?? 0;
  const inputs = accumulatorToInputs(acc, pendingApprovals, nowMillis, windowCutoff);
  const signal = scoreFamilyHealth(inputs, thresholds);

  // Per-day completion / approval trend for the window.
  const trendByDay = new Map<string, { completed: number; approved: number }>();
  for (let day = FAMILY_HEALTH_WINDOW_DAYS - 1; day >= 0; day -= 1) {
    const date = new Date(nowMillis - day * DAY_MS).toISOString().slice(0, 10);
    trendByDay.set(date, { completed: 0, approved: 0 });
  }
  let responsibilityXpEvents = 0;
  for (const event of events) {
    const millis = Date.parse(event.timestamp);
    if (event.event === ANALYTICS_EVENTS.pillar_xp_earned && millis >= windowCutoff) {
      responsibilityXpEvents += 1;
    }
    if (millis < windowCutoff) continue;
    const date = new Date(millis).toISOString().slice(0, 10);
    const bucket = trendByDay.get(date);
    if (!bucket) continue;
    if (event.event === ANALYTICS_EVENTS.chore_completed) bucket.completed += 1;
    if (event.event === ANALYTICS_EVENTS.chore_approved) bucket.approved += 1;
  }

  const familyName = familyDoc ? readString(familyDoc.fields, "name") || "Family" : "Family";

  return {
    familyId,
    familyName,
    generatedAt: now.toISOString(),
    windowDays: FAMILY_HEALTH_WINDOW_DAYS,
    score: signal.score,
    state: signal.state,
    reasons: signal.reasons,
    breakdown: signal.breakdown,
    inputs,
    pendingApprovals,
    completionTrend: Array.from(trendByDay.entries()).map(([date, value]) => ({
      date,
      completed: value.completed,
      approved: value.approved,
    })),
    parentActivity: {
      lastActive: toIso(acc.lastParentMillis),
      eventsInWindow: events.filter(
        (event) => event.role === PARENT_ROLE && Date.parse(event.timestamp) >= windowCutoff,
      ).length,
    },
    childActivity: {
      lastActive: toIso(acc.lastChildMillis),
      eventsInWindow: events.filter(
        (event) => event.role === CHILD_ROLE && Date.parse(event.timestamp) >= windowCutoff,
      ).length,
    },
    routineActivity: { created: acc.routineCreatedRecent, completed: acc.routineCompletedRecent },
    responsibilityXpEvents,
    recentEvents: events.slice(0, DETAIL_RECENT_EVENTS),
  };
}
