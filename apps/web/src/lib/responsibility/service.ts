import { randomUUID } from "node:crypto";
import {
  createOrReplaceDocument,
  documentIdFromName,
  getDocument,
  integerField,
  listAllDocuments,
  readInteger,
  readString,
  readTimestamp,
  stringField,
  timestampField,
  type FirestoreValue,
} from "@/lib/firestore/rest";
import { loadResponsibilityConfig } from "@/lib/responsibility/config";
import { levelForXp, levelProgressForXp } from "@/lib/responsibility/levels";
import { titleProgressForPillar, titleUnlockTier } from "@/lib/responsibility/titles";
import type { PillarIdentity } from "@/lib/responsibility/identity";
import {
  RESPONSIBILITY_PILLARS,
  normalizeResponsibilityPillar,
  type ResponsibilityPillar,
  type ResponsibilityProgressSummary,
  type ResponsibilityXpEventType,
} from "@/lib/responsibility/types";

// Storage layout (all family-scoped, FAMILY_PRIVATE / CHILD_SENSITIVE):
// - families/{familyId}/responsibilityXpEvents/{id} — append-only XP award
//   events; the immutable source of truth.
// - families/{familyId}/responsibilityProgress/{playerUid} — additive
//   aggregate (per-pillar XP plus counters) maintained alongside each event so
//   reads never need to scan the event log.
const XP_EVENTS_COLLECTION = "responsibilityXpEvents";
const PROGRESS_COLLECTION = "responsibilityProgress";

export function pillarXpFieldName(pillar: ResponsibilityPillar) {
  return `xp_${pillar}`;
}

export type ResponsibilityXpAward = {
  playerId: string;
  pillar: ResponsibilityPillar;
  xpAwarded: number;
  eventType: ResponsibilityXpEventType;
  choreId?: string;
  routineId?: string;
};

// The awarded pillar's cumulative XP immediately before and after this award,
// used by callers to detect title-tier transitions for celebrations.
export type ResponsibilityXpAwardResult = {
  pillarXpBefore: number;
  pillarXpAfter: number;
};

// Writes one XP event and folds it into the player's aggregate document.
// XP is additive and event-driven: the aggregate is read-modify-write per
// award, which matches how wallet payouts already behave in this codebase
// (awards fire from single status transitions, so concurrent double-awards
// are prevented upstream by the chore/routine state machine).
export async function recordResponsibilityXpAward(input: {
  familyId: string;
  idToken: string;
  award: ResponsibilityXpAward;
}): Promise<ResponsibilityXpAwardResult | null> {
  const { familyId, idToken, award } = input;
  if (!familyId || !award.playerId || award.xpAwarded <= 0) {
    return null;
  }
  const now = new Date().toISOString();
  const eventId = randomUUID();
  await createOrReplaceDocument(
    `families/${familyId}/${XP_EVENTS_COLLECTION}/${eventId}`,
    {
      playerId: stringField(award.playerId),
      pillar: stringField(award.pillar),
      xpAwarded: integerField(award.xpAwarded),
      eventType: stringField(award.eventType),
      choreId: stringField(award.choreId ?? ""),
      routineId: stringField(award.routineId ?? ""),
      createdAt: timestampField(now),
    },
    idToken,
  );

  const progressPath = `families/${familyId}/${PROGRESS_COLLECTION}/${award.playerId}`;
  let existingFields: Record<string, FirestoreValue> | undefined;
  try {
    const doc = await getDocument(progressPath, idToken);
    existingFields = doc.fields;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (!reason.includes("FIRESTORE_HTTP_404")) {
      throw error;
    }
  }

  const fields: Record<string, FirestoreValue> = {
    playerId: stringField(award.playerId),
    updatedAt: timestampField(now),
    lastEventAt: timestampField(now),
  };
  let pillarXpBefore = 0;
  let pillarXpAfter = 0;
  for (const pillar of RESPONSIBILITY_PILLARS) {
    const fieldName = pillarXpFieldName(pillar);
    const current = readInteger(existingFields, fieldName);
    const next = pillar === award.pillar ? current + award.xpAwarded : current;
    if (pillar === award.pillar) {
      pillarXpBefore = current;
      pillarXpAfter = next;
    }
    fields[fieldName] = integerField(next);
  }
  fields.totalXp = integerField(readInteger(existingFields, "totalXp") + award.xpAwarded);
  fields.skillsLearned = integerField(
    readInteger(existingFields, "skillsLearned") +
      (award.eventType === "new_skill_bonus" ? 1 : 0),
  );
  // Routine completion counters are maintained by
  // recordRoutineCompletionStatsBestEffort (they must move even for routines
  // without a pillar, which never reach this XP path) — carry them through
  // unchanged since this write replaces the whole document.
  fields.routinesCompleted = integerField(readInteger(existingFields, "routinesCompleted"));
  fields.routineCompletionsJson = stringField(
    readString(existingFields, "routineCompletionsJson"),
  );
  await createOrReplaceDocument(progressPath, fields, idToken);
  return { pillarXpBefore, pillarXpAfter };
}

// Best-effort variant for completion/approval hot paths: XP must never break
// an existing chore workflow, so failures are logged and swallowed. Returns
// whether the award succeeded plus the awarded pillar's before/after XP (for
// title-transition detection); `result` is null when nothing was written.
export async function recordResponsibilityXpAwardBestEffort(input: {
  familyId: string;
  idToken: string;
  award: ResponsibilityXpAward;
}): Promise<{ ok: boolean; result: ResponsibilityXpAwardResult | null }> {
  try {
    const result = await recordResponsibilityXpAward(input);
    return { ok: true, result };
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message.slice(0, 200) : "unknown";
    console.error("[RESPONSIBILITY_XP_AWARD_ERROR]", {
      familyId: input.familyId,
      playerId: input.award.playerId,
      eventType: input.award.eventType,
      reason,
    });
    return { ok: false, result: null };
  }
}

// Responsibility Identity snapshot for the player whose completion is being
// celebrated (the dashboard shows their pillar title growing). Computed only
// when a `celebrationPlayerUid` is supplied and that player earned pillar XP.
export type ChoreTitleOutcome = {
  pillar: ResponsibilityPillar;
  xpBefore: number;
  xpAfter: number;
  levelBefore: number;
  levelAfter: number;
  // Title tier after the award and the next tier (null at the top).
  tier: number;
  nextTier: number | null;
  // Title-band progress fractions before and after this completion, so the UI
  // can animate the bar growing.
  prevFraction: number;
  newFraction: number;
  // True when this completion crossed into a new title tier.
  unlocked: boolean;
};

export type ChoreXpOutcome = {
  pillar: ResponsibilityPillar | "";
  choreXpAwarded: number;
  newSkillXpAwarded: number;
  title?: ChoreTitleOutcome;
};

const EMPTY_CHORE_XP_OUTCOME: ChoreXpOutcome = {
  pillar: "",
  choreXpAwarded: 0,
  newSkillXpAwarded: 0,
};

// Awards Responsibility XP for a paid chore completion. Called at the same
// lifecycle point as coin payout (immediate completion or approval). Chores
// without a pillar assignment silently award no XP — pillar metadata is
// always optional and must never break existing workflows.
export async function awardChoreResponsibilityXpBestEffort(input: {
  familyId: string;
  idToken: string;
  choreId: string;
  choreFields: Record<string, FirestoreValue> | undefined;
  paidPlayerUids: string[];
  newSkillPlayerUids: string[];
  // When set, the title progress/unlock for this player is captured into the
  // outcome so the dashboard can celebrate the completing child's identity.
  celebrationPlayerUid?: string;
}): Promise<ChoreXpOutcome> {
  const {
    familyId,
    idToken,
    choreId,
    choreFields,
    paidPlayerUids,
    newSkillPlayerUids,
    celebrationPlayerUid,
  } = input;
  const pillar = normalizeResponsibilityPillar(readString(choreFields, "responsibilityPillar"));
  if (!pillar) {
    return EMPTY_CHORE_XP_OUTCOME;
  }
  const config = await loadResponsibilityConfig();
  // Per-chore XP override (responsibilityXpReward) falls back to the global
  // configured chore completion value.
  const overrideXp =
    choreFields && "responsibilityXpReward" in choreFields
      ? readInteger(choreFields, "responsibilityXpReward")
      : -1;
  const choreXp = overrideXp >= 0 ? overrideXp : config.xpValues.choreCompletionXp;
  let choreXpAwarded = 0;
  let newSkillXpAwarded = 0;
  // Track the celebration player's first "before" and last "after" pillar XP
  // across all of their awards (chore XP + any new-skill bonus) so the title
  // transition reflects the whole completion.
  let celebXpBefore: number | null = null;
  let celebXpAfter: number | null = null;
  const captureCeleb = (playerId: string, result: ResponsibilityXpAwardResult | null) => {
    if (!result || playerId !== celebrationPlayerUid) {
      return;
    }
    if (celebXpBefore === null) {
      celebXpBefore = result.pillarXpBefore;
    }
    celebXpAfter = result.pillarXpAfter;
  };
  const seen = new Set<string>();
  for (const playerId of paidPlayerUids) {
    if (!playerId || seen.has(playerId)) {
      continue;
    }
    seen.add(playerId);
    if (choreXp > 0) {
      const { ok, result } = await recordResponsibilityXpAwardBestEffort({
        familyId,
        idToken,
        award: { playerId, pillar, xpAwarded: choreXp, eventType: "chore_completed", choreId },
      });
      if (ok) {
        choreXpAwarded += choreXp;
      }
      captureCeleb(playerId, result);
    }
  }
  const newSkillXp = config.xpValues.newSkillBonusXp;
  for (const playerId of new Set(newSkillPlayerUids)) {
    if (!playerId || newSkillXp <= 0) {
      continue;
    }
    const { ok, result } = await recordResponsibilityXpAwardBestEffort({
      familyId,
      idToken,
      award: { playerId, pillar, xpAwarded: newSkillXp, eventType: "new_skill_bonus", choreId },
    });
    if (ok) {
      newSkillXpAwarded += newSkillXp;
    }
    captureCeleb(playerId, result);
  }
  let title: ChoreTitleOutcome | undefined;
  if (celebXpBefore !== null && celebXpAfter !== null && celebXpAfter !== celebXpBefore) {
    const before = titleProgressForPillar({ xp: celebXpBefore, thresholds: config.levelThresholds });
    const after = titleProgressForPillar({ xp: celebXpAfter, thresholds: config.levelThresholds });
    title = {
      pillar,
      xpBefore: celebXpBefore,
      xpAfter: celebXpAfter,
      levelBefore: levelForXp(celebXpBefore, config.levelThresholds),
      levelAfter: levelForXp(celebXpAfter, config.levelThresholds),
      tier: after.tier,
      nextTier: after.nextTier,
      prevFraction: before.tier === after.tier ? before.titleProgressFraction : 0,
      newFraction: after.titleProgressFraction,
      unlocked:
        titleUnlockTier(celebXpBefore, celebXpAfter, config.levelThresholds) !== null,
    };
  }
  return { pillar, choreXpAwarded, newSkillXpAwarded, title };
}

// Per-routine completion stats stored on the player's progress document as a
// JSON map {routineId: {name, count}}, capped so the document stays small.
const MAX_TRACKED_ROUTINE_COMPLETIONS = 100;

export type RoutineCompletionStats = Record<string, { name: string; count: number }>;

export function parseRoutineCompletionsJson(json: string): RoutineCompletionStats {
  if (!json) {
    return {};
  }
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const stats: RoutineCompletionStats = {};
    for (const [routineId, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (
        entry &&
        typeof entry === "object" &&
        typeof (entry as { name?: unknown }).name === "string" &&
        typeof (entry as { count?: unknown }).count === "number"
      ) {
        stats[routineId] = {
          name: (entry as { name: string }).name,
          count: Math.max(0, Math.trunc((entry as { count: number }).count)),
        };
      }
    }
    return stats;
  } catch {
    return {};
  }
}

export function mostCompletedRoutineFromStats(
  stats: RoutineCompletionStats,
): { routineId: string; name: string; count: number } | null {
  let best: { routineId: string; name: string; count: number } | null = null;
  for (const [routineId, entry] of Object.entries(stats)) {
    if (entry.count > 0 && (!best || entry.count > best.count)) {
      best = { routineId, name: entry.name, count: entry.count };
    }
  }
  return best;
}

// Counts one routine completion for a player. Separate from the XP path on
// purpose: routines without a Responsibility Pillar still pay coins and still
// count toward "Routines Completed" / "Most Completed Routine".
export async function recordRoutineCompletionStatsBestEffort(input: {
  familyId: string;
  idToken: string;
  playerId: string;
  routineId: string;
  routineName: string;
}): Promise<void> {
  const { familyId, idToken, playerId, routineId, routineName } = input;
  if (!familyId || !playerId || !routineId) {
    return;
  }
  try {
    const progressPath = `families/${familyId}/${PROGRESS_COLLECTION}/${playerId}`;
    let existingFields: Record<string, FirestoreValue> | undefined;
    try {
      const doc = await getDocument(progressPath, idToken);
      existingFields = doc.fields;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "";
      if (!reason.includes("FIRESTORE_HTTP_404")) {
        throw error;
      }
    }
    const stats = parseRoutineCompletionsJson(
      readString(existingFields, "routineCompletionsJson"),
    );
    const current = stats[routineId];
    if (!current && Object.keys(stats).length >= MAX_TRACKED_ROUTINE_COMPLETIONS) {
      // Map is full: still bump the total counter, just skip per-routine detail.
    } else {
      stats[routineId] = {
        name: routineName || current?.name || "Untitled routine",
        count: (current?.count ?? 0) + 1,
      };
    }
    const now = new Date().toISOString();
    const fields: Record<string, FirestoreValue> = {
      playerId: stringField(playerId),
      updatedAt: timestampField(now),
      routinesCompleted: integerField(readInteger(existingFields, "routinesCompleted") + 1),
      routineCompletionsJson: stringField(JSON.stringify(stats)),
    };
    // Preserve everything else in the replace-style write.
    for (const pillar of RESPONSIBILITY_PILLARS) {
      const fieldName = pillarXpFieldName(pillar);
      fields[fieldName] = integerField(readInteger(existingFields, fieldName));
    }
    fields.totalXp = integerField(readInteger(existingFields, "totalXp"));
    fields.skillsLearned = integerField(readInteger(existingFields, "skillsLearned"));
    if (existingFields && "lastEventAt" in existingFields) {
      fields.lastEventAt = timestampField(readTimestamp(existingFields, "lastEventAt") || now);
    }
    await createOrReplaceDocument(progressPath, fields, idToken);
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 200) : "unknown";
    console.error("[ROUTINE_COMPLETION_STATS_ERROR]", {
      familyId: input.familyId,
      playerId: input.playerId,
      routineId: input.routineId,
      reason,
    });
  }
}

// Loads a player's aggregated responsibility progress and derives levels.
export async function getResponsibilityProgress(input: {
  familyId: string;
  playerUid: string;
  idToken: string;
}): Promise<ResponsibilityProgressSummary> {
  const { familyId, playerUid, idToken } = input;
  let fields: Record<string, FirestoreValue> | undefined;
  try {
    const doc = await getDocument(
      `families/${familyId}/${PROGRESS_COLLECTION}/${playerUid}`,
      idToken,
    );
    fields = doc.fields;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (!reason.includes("FIRESTORE_HTTP_404")) {
      throw error;
    }
  }
  const config = await loadResponsibilityConfig();
  let mostActivePillar: ResponsibilityPillar | "" = "";
  let mostActiveXp = 0;
  const pillars = RESPONSIBILITY_PILLARS.map((pillar) => {
    const xp = Math.max(0, readInteger(fields, pillarXpFieldName(pillar)));
    if (xp > mostActiveXp) {
      mostActiveXp = xp;
      mostActivePillar = pillar;
    }
    const progress = levelProgressForXp(xp, config.levelThresholds);
    const title = titleProgressForPillar({ xp, thresholds: config.levelThresholds });
    return {
      pillar,
      xp,
      level: progress.level,
      currentLevelFloorXp: progress.currentLevelFloorXp,
      nextLevelXp: progress.nextLevelXp,
      progressFraction: progress.progressFraction,
      titleTier: title.tier,
      nextTitleTier: title.nextTier,
      titleProgressFraction: title.titleProgressFraction,
    };
  });
  return {
    playerId: playerUid,
    totalXp: Math.max(0, readInteger(fields, "totalXp")),
    skillsLearned: Math.max(0, readInteger(fields, "skillsLearned")),
    routinesCompleted: Math.max(0, readInteger(fields, "routinesCompleted")),
    mostActivePillar,
    mostCompletedRoutine: mostCompletedRoutineFromStats(
      parseRoutineCompletionsJson(readString(fields, "routineCompletionsJson")),
    ),
    pillars,
  };
}

// Derives the earned pillar identities from one progress doc's fields.
// Shared shaping for the family-wide identities endpoint; the per-pillar title
// derivation mirrors getResponsibilityProgress.
function pillarIdentitiesFromFields(
  fields: Record<string, FirestoreValue> | undefined,
  thresholds: number[],
): PillarIdentity[] {
  const identities: PillarIdentity[] = [];
  for (const pillar of RESPONSIBILITY_PILLARS) {
    const xp = Math.max(0, readInteger(fields, pillarXpFieldName(pillar)));
    const level = levelForXp(xp, thresholds);
    if (level <= 1) {
      continue;
    }
    const title = titleProgressForPillar({ xp, thresholds });
    identities.push({
      pillar,
      level,
      xp,
      titleTier: title.tier,
      nextTitleTier: title.nextTier,
      titleProgressFraction: title.titleProgressFraction,
    });
  }
  return identities;
}

// Batch-reads every family member's responsibility identities in one collection
// scan (instead of one progress read per member). Returns a map keyed by player
// uid (the progress doc id) → earned pillar identities, for the V2 family
// recognition surfaces (profile/kiosk selection chips, parent Family Growth).
export async function getFamilyResponsibilityIdentities(input: {
  familyId: string;
  idToken: string;
}): Promise<Record<string, PillarIdentity[]>> {
  const { familyId, idToken } = input;
  const config = await loadResponsibilityConfig();
  const docs = await listAllDocuments(`families/${familyId}/${PROGRESS_COLLECTION}`, idToken, {
    cap: 200,
  });
  const byPlayer: Record<string, PillarIdentity[]> = {};
  for (const doc of docs) {
    const playerUid = readString(doc.fields, "playerId") || documentIdFromName(doc.name);
    if (!playerUid) {
      continue;
    }
    const identities = pillarIdentitiesFromFields(doc.fields, config.levelThresholds);
    if (identities.length > 0) {
      byPlayer[playerUid] = identities;
    }
  }
  return byPlayer;
}
