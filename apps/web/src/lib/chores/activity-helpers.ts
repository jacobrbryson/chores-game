import { readInteger, readString, type FirestoreValue } from "@/lib/firestore/rest";
import { emitFamilyActivity } from "@/lib/notifications/events";
import { syncGoogleTasksForUser } from "@/lib/google/tasks-sync";
import { computeCompletionDerivedMaximums, trackAchievementEvent } from "@/lib/achievements/service";

// Best-effort side effects that must never fail a chore mutation. Each logs and
// swallows its error so the primary transition still succeeds.

export async function syncGoogleTasksBestEffort(input: {
  uid: string;
  idToken: string;
  force?: boolean;
  minIntervalSeconds?: number;
}) {
  try {
    await syncGoogleTasksForUser(input);
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[GOOGLE_TASKS_SYNC_AFTER_CHORE_ERROR]", reason);
  }
}

export async function trackAchievementEventBestEffort(
  input: Parameters<typeof trackAchievementEvent>[0],
) {
  try {
    await trackAchievementEvent(input);
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[ACHIEVEMENT_TRACK_AFTER_CHORE_ERROR]", reason);
  }
}

export async function computeCompletionDerivedMaximumsBestEffort(
  input: Parameters<typeof computeCompletionDerivedMaximums>[0],
) {
  try {
    return await computeCompletionDerivedMaximums(input);
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[ACHIEVEMENT_DERIVED_AFTER_CHORE_ERROR]", reason);
    return undefined;
  }
}

export async function emitFamilyActivityBestEffort(input: Parameters<typeof emitFamilyActivity>[0]) {
  try {
    await emitFamilyActivity(input);
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[FAMILY_ACTIVITY_AFTER_CHORE_ERROR]", reason);
  }
}

// " (step 2 of 4 in the "Clean Room" routine)" suffix for activity messages, or
// "" for chores that are not routine steps.
export function describeRoutineStepContext(
  choreFields: Record<string, FirestoreValue> | undefined,
) {
  const routineName = readString(choreFields, "routineName");
  if (!routineName) {
    return "";
  }
  const stepOrder = readInteger(choreFields, "routineStepOrder");
  const stepCount = readInteger(choreFields, "routineStepCount");
  if (stepOrder > 0 && stepCount > 0) {
    return ` (step ${stepOrder} of ${stepCount} in the "${routineName}" routine)`;
  }
  return ` (part of the "${routineName}" routine)`;
}
