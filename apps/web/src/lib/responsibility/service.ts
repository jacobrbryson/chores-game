import { randomUUID } from "node:crypto";
import {
  createOrReplaceDocument,
  getDocument,
  integerField,
  readInteger,
  readString,
  readTimestamp,
  stringField,
  timestampField,
  type FirestoreValue,
} from "@/lib/firestore/rest";
import { loadResponsibilityConfig } from "@/lib/responsibility/config";
import { levelProgressForXp } from "@/lib/responsibility/levels";
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

// Writes one XP event and folds it into the player's aggregate document.
// XP is additive and event-driven: the aggregate is read-modify-write per
// award, which matches how wallet payouts already behave in this codebase
// (awards fire from single status transitions, so concurrent double-awards
// are prevented upstream by the chore/routine state machine).
export async function recordResponsibilityXpAward(input: {
  familyId: string;
  idToken: string;
  award: ResponsibilityXpAward;
}): Promise<void> {
  const { familyId, idToken, award } = input;
  if (!familyId || !award.playerId || award.xpAwarded <= 0) {
    return;
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
  for (const pillar of RESPONSIBILITY_PILLARS) {
    const fieldName = pillarXpFieldName(pillar);
    const current = readInteger(existingFields, fieldName);
    const next = pillar === award.pillar ? current + award.xpAwarded : current;
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
}

// Best-effort variant for completion/approval hot paths: XP must never break
// an existing chore workflow, so failures are logged and swallowed.
export async function recordResponsibilityXpAwardBestEffort(input: {
  familyId: string;
  idToken: string;
  award: ResponsibilityXpAward;
}): Promise<boolean> {
  try {
    await recordResponsibilityXpAward(input);
    return true;
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message.slice(0, 200) : "unknown";
    console.error("[RESPONSIBILITY_XP_AWARD_ERROR]", {
      familyId: input.familyId,
      playerId: input.award.playerId,
      eventType: input.award.eventType,
      reason,
    });
    return false;
  }
}

export type ChoreXpOutcome = {
  pillar: ResponsibilityPillar | "";
  choreXpAwarded: number;
  newSkillXpAwarded: number;
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
}): Promise<ChoreXpOutcome> {
  const { familyId, idToken, choreId, choreFields, paidPlayerUids, newSkillPlayerUids } = input;
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
  const seen = new Set<string>();
  for (const playerId of paidPlayerUids) {
    if (!playerId || seen.has(playerId)) {
      continue;
    }
    seen.add(playerId);
    if (choreXp > 0) {
      const ok = await recordResponsibilityXpAwardBestEffort({
        familyId,
        idToken,
        award: { playerId, pillar, xpAwarded: choreXp, eventType: "chore_completed", choreId },
      });
      if (ok) {
        choreXpAwarded += choreXp;
      }
    }
  }
  const newSkillXp = config.xpValues.newSkillBonusXp;
  for (const playerId of new Set(newSkillPlayerUids)) {
    if (!playerId || newSkillXp <= 0) {
      continue;
    }
    const ok = await recordResponsibilityXpAwardBestEffort({
      familyId,
      idToken,
      award: { playerId, pillar, xpAwarded: newSkillXp, eventType: "new_skill_bonus", choreId },
    });
    if (ok) {
      newSkillXpAwarded += newSkillXp;
    }
  }
  return { pillar, choreXpAwarded, newSkillXpAwarded };
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
    return {
      pillar,
      xp,
      level: progress.level,
      currentLevelFloorXp: progress.currentLevelFloorXp,
      nextLevelXp: progress.nextLevelXp,
      progressFraction: progress.progressFraction,
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
