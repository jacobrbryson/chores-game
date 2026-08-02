import { randomUUID } from "node:crypto";
import {
  boolField,
  createOrReplaceDocument,
  getDocument,
  integerField,
  listAllDocuments,
  patchDocument,
  readBoolean,
  readInteger,
  readString,
  readStringArray,
  readTimestamp,
  stringArrayField,
  stringField,
  timestampField,
  type FirestoreValue,
} from "@/lib/firestore/rest";
import { publishFamilyActivity } from "@/lib/ws/publish-family-activity";
import { writeAuditLogBestEffort } from "@/lib/audit/log";
import { trackEvent } from "@/lib/analytics/service";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { buildKioskActivityMetadata } from "@/lib/auth/kiosk";
import { GOOGLE_TASKS_CHORE_SOURCE } from "@/lib/google/tasks-sync";
import {
  nextRecurringDueDate,
  normalizeCoinValue,
  normalizeRecurrenceConfig,
  recurrenceLabel,
} from "@/lib/chores/recurrence";
import { normalizeChoreType } from "@/lib/chores/types";
import { normalizeResponsibilityPillar } from "@/lib/responsibility/types";
import { titleNameEn } from "@/lib/responsibility/titles";
import { readChoreCategoryIds } from "@/lib/family/categories";
import { canonicalRecurringChoreId } from "@/lib/chores/skill-bonus";
import { awardChoreResponsibilityXpBestEffort } from "@/lib/responsibility/service";
import { recordRoutineStepCompletionBestEffort } from "@/lib/responsibility/assignment-service";
import { getRequesterContext, isRequesterAssignee } from "@/lib/chores/access";
import {
  resolveAssigneeName,
  resolveAssigneeUid,
  resolveChoreAssigneeIds,
  userHasFamilyMembership,
} from "@/lib/chores/assignees";
import { applyPayoutByAssignee, buildPayoutByAssignee } from "@/lib/chores/payouts";
import {
  awardNewSkillBonuses,
  resolvePaidPlayerUids,
  type NewSkillBonusOutcome,
} from "@/lib/chores/bonus-award";
import { resolveStoredNewSkillEnabled } from "@/lib/chores/input";
import {
  computeCompletionDerivedMaximumsBestEffort,
  describeRoutineStepContext,
  emitFamilyActivityBestEffort,
  trackAchievementEventBestEffort,
} from "@/lib/chores/activity-helpers";
import type { ChoreXpOutcome } from "@/lib/responsibility/service";
import type { RoutineStepProgressOutcome } from "@/lib/responsibility/assignment-service";
import {
  EMPTY_RESPONSIBILITY_XP,
  type ChoreActionContext,
  type ChoreActionOutcome,
} from "./context";

// Safety cap when paging the full chores collection (recurring chores grow it
// without bound). Mirrors MAX_CHORE_ARCHIVE in the chores list route.
const MAX_CHORE_SCAN = 5000;

export async function handleComplete(ctx: ChoreActionContext): Promise<ChoreActionOutcome> {
  const { familyId, idToken, session, choreId, now, actorName, body } = ctx;
  let syncOwnerUid = "";
  let newSkillBonus: NewSkillBonusOutcome = {
    awarded: false,
    amount: 0,
    totalCoins: 0,
    playerUids: [],
  };
  let responsibilityXp: ChoreXpOutcome = EMPTY_RESPONSIBILITY_XP;
  let routineProgress: RoutineStepProgressOutcome | null = null;

  const existingChoreDoc = await getDocument(`families/${familyId}/chores/${choreId}`, idToken);
  const choreTitle = readString(existingChoreDoc.fields, "title") || "Untitled chore";
  const choreAssigneeId = readString(existingChoreDoc.fields, "assigneeId");
  const choreAssigneeIdsRaw = readStringArray(existingChoreDoc.fields, "assigneeIds");
  const choreAssigneeScope = readString(existingChoreDoc.fields, "assigneeScope");
  const choreType = normalizeChoreType(
    readString(existingChoreDoc.fields, "choreType"),
    choreAssigneeScope === "family" || choreAssigneeIdsRaw.length > 1 ? "group" : "normal",
  );
  const choreAssigneeIds = await resolveChoreAssigneeIds(familyId, existingChoreDoc.fields, idToken);
  const choreSource = readString(existingChoreDoc.fields, "source");
  const choreGoogleTaskOwnerUid = readString(existingChoreDoc.fields, "googleTaskOwnerUid");
  const choreCoinValue = normalizeCoinValue(readInteger(existingChoreDoc.fields, "coinValue"));
  const choreDetails = readString(existingChoreDoc.fields, "details") || "";
  const choreCategoryIds = readChoreCategoryIds(existingChoreDoc.fields);
  const choreRequireApproval = readBoolean(existingChoreDoc.fields, "requireApproval");
  const choreNewSkillEnabled = resolveStoredNewSkillEnabled(existingChoreDoc.fields);
  const choreRecurrence = normalizeRecurrenceConfig({
    recurrenceType: readString(existingChoreDoc.fields, "recurrenceType"),
    recurrenceInterval: readInteger(existingChoreDoc.fields, "recurrenceInterval"),
    recurrenceUnit: readString(existingChoreDoc.fields, "recurrenceUnit"),
    recurrenceDays: readStringArray(existingChoreDoc.fields, "recurrenceDays"),
  });
  const currentStatus = readString(existingChoreDoc.fields, "status") || "Open";
  const choreRoutineAssignmentId = readString(existingChoreDoc.fields, "routineAssignmentId");
  const hadPriorSubmission = Boolean(readTimestamp(existingChoreDoc.fields, "submittedAt"));
  // Canonical identity used for the New Skill Bonus: the root chore of a
  // recurring series so the bonus is granted only on the child's first
  // completion of the recurring task, never on later occurrences.
  const rootChoreId = canonicalRecurringChoreId(existingChoreDoc.fields, choreId);
  if (choreSource === GOOGLE_TASKS_CHORE_SOURCE && choreGoogleTaskOwnerUid) {
    syncOwnerUid = choreGoogleTaskOwnerUid;
  } else if (isRequesterAssignee(choreAssigneeId, session.uid, session.memberId, session.email)) {
    syncOwnerUid = session.uid;
  }
  // A skipped routine step can be picked back up and completed (from the routine
  // progress dialog), so completion is valid from Open or — for a routine step
  // only — from Skipped. recordRoutineStepCompletion then moves it out of the
  // assignment's skipped set into completed.
  const resumingSkippedStep = currentStatus === "Skipped" && Boolean(choreRoutineAssignmentId);
  if (currentStatus !== "Open" && !resumingSkippedStep) {
    return { kind: "invalid_transition" as const };
  }
  const requesterOwnsChore = choreAssigneeIds.some((id) =>
    isRequesterAssignee(id, session.uid, session.memberId, session.email),
  );
  const requester = await getRequesterContext(familyId, session.uid, session.email, idToken);
  if (!requesterOwnsChore && requester.role !== "admin") {
    return { kind: "forbidden_action" as const };
  }
  let spawnedNextChoreId = "";
  const approvalRequiredByChore =
    choreRequireApproval || choreAssigneeIds.length > 1 || choreType === "see_and_do";
  const completionNeedsApproval = requester.role !== "admin" && approvalRequiredByChore;
  const nextStatus = completionNeedsApproval ? "Submitted" : "Approved";
  const payoutByAssignee =
    nextStatus === "Approved"
      ? buildPayoutByAssignee({
          assigneeIds: choreAssigneeIds,
          totalCoinValue: choreCoinValue,
          overrides: body.approvalPayouts,
        })
      : new Map<string, number>();
  const approvedCoinValue =
    nextStatus === "Approved"
      ? Array.from(payoutByAssignee.values()).reduce(
          (total, coins) => total + Math.max(0, Math.trunc(coins || 0)),
          0,
        )
      : choreCoinValue;
  const completionDate = now.slice(0, 10);
  if (choreRecurrence.recurrenceType !== "none") {
    const nextDueDate = nextRecurringDueDate(completionDate, choreRecurrence, completionDate);
    const allChoreDocs = await listAllDocuments(`families/${familyId}/chores`, idToken, {
      cap: MAX_CHORE_SCAN,
    });
    const openChores = allChoreDocs.filter((doc) => {
      if (readBoolean(doc.fields, "deleted")) {
        return false;
      }
      return readString(doc.fields, "status") === "Open";
    });
    const nextSortOrder =
      openChores.reduce((maxValue, doc) => {
        const value = doc.fields?.sortOrder;
        const raw =
          value && "integerValue" in value
            ? Number(value.integerValue)
            : value && "stringValue" in value
              ? Number(value.stringValue)
              : Number.NaN;
        return Number.isFinite(raw) ? Math.max(maxValue, Math.trunc(raw)) : maxValue;
      }, -1) + 1;
    spawnedNextChoreId = randomUUID();
    await createOrReplaceDocument(
      `families/${familyId}/chores/${spawnedNextChoreId}`,
      {
        title: stringField(choreTitle),
        choreType: stringField(choreType),
        status: stringField("Open"),
        assigneeId: stringField(choreAssigneeId),
        assigneeIds: stringArrayField(choreAssigneeIdsRaw),
        assigneeScope: stringField(choreAssigneeScope || "single"),
        assigneeName: stringField(readString(existingChoreDoc.fields, "assigneeName") || "Unassigned"),
        details: stringField(choreDetails),
        categoryIds: stringArrayField(choreCategoryIds),
        dueDate: stringField(nextDueDate),
        coinValue: integerField(choreCoinValue),
        requireApproval: boolField(choreRequireApproval),
        newSkillEnabled: boolField(choreNewSkillEnabled),
        recurrenceType: stringField(choreRecurrence.recurrenceType),
        recurrenceInterval: integerField(choreRecurrence.recurrenceInterval ?? 0),
        recurrenceUnit: stringField(choreRecurrence.recurrenceUnit ?? ""),
        recurrenceDays: stringArrayField(choreRecurrence.recurrenceDays ?? []),
        recurrenceParentChoreId: stringField(choreId),
        recurrenceRootChoreId: stringField(rootChoreId),
        responsibilityPillar: stringField(
          normalizeResponsibilityPillar(
            readString(existingChoreDoc.fields, "responsibilityPillar"),
          ),
        ),
        deleted: boolField(false),
        createdBy: stringField(session.uid),
        createdAt: timestampField(now),
        sortOrder: integerField(nextSortOrder),
        source: stringField("manual"),
      },
      idToken,
    );
  }
  const completionPatchFields: Record<string, FirestoreValue> = {
    status: stringField(nextStatus),
    submittedAt: timestampField(now),
    updatedAt: timestampField(now),
    spawnedNextChoreId: stringField(spawnedNextChoreId),
  };
  const completionUpdateMask = ["status", "submittedAt", "updatedAt", "spawnedNextChoreId"];
  if (nextStatus === "Approved") {
    completionPatchFields.approvalPayoutsJson = stringField(
      JSON.stringify(
        Array.from(payoutByAssignee.entries()).map(([assigneeId, coinValue]) => ({
          assigneeId,
          coinValue,
        })),
      ),
    );
    completionPatchFields.coinValue = integerField(approvedCoinValue);
    completionUpdateMask.push("approvalPayoutsJson", "coinValue");
  }
  await patchDocument(
    `families/${familyId}/chores/${choreId}`,
    completionPatchFields,
    idToken,
    completionUpdateMask,
  );
  await writeAuditLogBestEffort({
    familyId,
    idToken,
    eventType: "chore_status_changed",
    actor: { uid: session.uid, email: session.email, name: actorName, role: requester.role },
    userId: choreAssigneeId,
    choreId,
    choreTitle,
    source: choreSource || "manual",
    previous: { status: currentStatus },
    next: {
      status: nextStatus,
      coinValue: approvedCoinValue,
      submittedAt: now,
      spawnedNextChoreId,
      requireApproval: completionNeedsApproval,
    },
    reason: "complete",
  });
  let payoutApplied = false;
  if (nextStatus === "Approved") {
    const payoutResult = await applyPayoutByAssignee({
      familyId,
      idToken,
      choreId,
      payoutByAssignee,
      direction: "credit",
      actorUid: session.uid,
      actorRole: requester.role,
      choreStatus: currentStatus,
    });
    if (payoutResult.kind === "wallet_permission_denied") {
      return { kind: "wallet_permission_denied" as const };
    }
    payoutApplied = payoutResult.kind === "ok" && payoutResult.anyApplied;
    if (choreNewSkillEnabled) {
      newSkillBonus = await awardNewSkillBonuses({
        familyId,
        idToken,
        rootChoreId,
        payoutByAssignee,
        sourceCompletionId: choreId,
      });
    }
    // Responsibility XP rides the same payout lifecycle: chore XP for every paid
    // player plus bonus XP when the New Skill Bonus fired. Chores without a
    // pillar award nothing, silently.
    responsibilityXp = await awardChoreResponsibilityXpBestEffort({
      familyId,
      idToken,
      choreId,
      choreFields: existingChoreDoc.fields,
      paidPlayerUids: await resolvePaidPlayerUids(familyId, payoutByAssignee, idToken),
      newSkillPlayerUids: newSkillBonus.playerUids,
      // Celebrate the completing actor's identity (in Kiosk this is the child).
      celebrationPlayerUid: session.uid,
    });
  }
  const primaryAssigneeAlias = choreAssigneeIds[0] || choreAssigneeId;
  const assigneeUid = await resolveAssigneeUid(familyId, primaryAssigneeAlias, idToken);
  const completedForSingleAssignee = requester.role === "admin" && choreAssigneeIds.length === 1;
  const completionActorName = completedForSingleAssignee
    ? await resolveAssigneeName(familyId, choreAssigneeIds[0], idToken, actorName)
    : actorName;
  const completionActorUid = completedForSingleAssignee
    ? assigneeUid || primaryAssigneeAlias
    : session.uid;
  const completionActorEmail = completedForSingleAssignee ? "" : session.email;
  // Kiosk Mode attribution: in kiosk the current identity is the player, so the
  // player is recorded as the actor (parents are still notified) while the
  // originally signed-in account is preserved as authenticated_user_id and the
  // event is tagged source=kiosk.
  const kioskActivity = buildKioskActivityMetadata(session, choreAssigneeId || assigneeUid);
  // Routine step bookkeeping rides the payout: marking the step done in its
  // assignment and, on the final step, paying the routine completion bonus +
  // pillar XP.
  if (nextStatus === "Approved") {
    routineProgress = await recordRoutineStepCompletionBestEffort({
      familyId,
      idToken,
      choreId,
      choreFields: existingChoreDoc.fields,
      playerUid: assigneeUid || "",
      actor: { uid: completionActorUid, email: completionActorEmail, name: completionActorName },
      kiosk: kioskActivity,
    });
  }
  const routineStepContext = describeRoutineStepContext(existingChoreDoc.fields);
  await emitFamilyActivityBestEffort({
    familyId,
    idToken,
    kind: "chore_completed",
    actorUid: completionActorUid,
    actorEmail: completionActorEmail,
    actorName: completionActorName,
    title: completionNeedsApproval ? "Chore submitted for approval" : "Chore completed",
    message: completionNeedsApproval
      ? `${completionActorName} completed "${choreTitle}"${routineStepContext} and it is waiting for parent approval.`
      : `${completionActorName} completed "${choreTitle}"${routineStepContext}${payoutApplied ? ` and earned ${approvedCoinValue} coins` : ""}.${newSkillBonus.awarded ? ` 🎉 New Skill Learned (+${newSkillBonus.totalCoins} bonus coins)!` : ""}${choreRecurrence.recurrenceType !== "none" ? ` ${recurrenceLabel(choreRecurrence)}.` : ""}`,
    choreId,
    choreTitle,
    relatedIds: choreAssigneeIds,
    pushType: completionNeedsApproval ? "chore_approval_required" : "chore_completed",
    source: kioskActivity.source,
    authenticatedUid: kioskActivity.authenticatedUid,
    completedForPlayerId: kioskActivity.completedForPlayerId,
    newSkillBonusAwarded: newSkillBonus.awarded,
    newSkillBonusAmount: newSkillBonus.totalCoins,
  });
  await publishFamilyActivity({
    type: "chore_completed",
    familyId,
    choreId,
    occurredAt: now,
    source: kioskActivity.source,
    authenticatedUid: kioskActivity.authenticatedUid,
    completedForPlayerId: kioskActivity.completedForPlayerId,
    newSkillBonusAwarded: newSkillBonus.awarded,
    newSkillBonusAmount: newSkillBonus.totalCoins,
  });
  // Responsibility Identity: when this completion unlocked a new title for the
  // completing child, announce it as its own celebratory feed line (reusing the
  // chore_completed kind — no new ActivityKind/WS type needed).
  if (responsibilityXp.title?.unlocked && responsibilityXp.title.pillar) {
    const titleName = titleNameEn(responsibilityXp.title.pillar, responsibilityXp.title.tier);
    await emitFamilyActivityBestEffort({
      familyId,
      idToken,
      kind: "identity_title_unlocked",
      actorUid: session.uid,
      actorEmail: session.email,
      actorName,
      title: "New title unlocked",
      message: `🎉 ${actorName} became a ${titleName}!`,
      relatedIds: choreAssigneeId ? [choreAssigneeId] : [],
      source: kioskActivity.source,
      authenticatedUid: kioskActivity.authenticatedUid,
      completedForPlayerId: kioskActivity.completedForPlayerId,
    });
    await publishFamilyActivity({
      type: "identity_title_unlocked",
      familyId,
      occurredAt: now,
    });
  }
  // Credit achievements to every assignee on the chore. Group, family, and
  // multi-assignee chores store an empty singular assigneeId, so resolving a
  // single uid (assigneeUid) would silently skip all completion-driven
  // achievements for them. Mirror the approval path and walk the full assignee
  // list instead, deduping resolved uids.
  const completionHour = new Date(now).getUTCHours();
  const creditedCompletionUids = new Set<string>();
  for (const assigneeAlias of choreAssigneeIds) {
    const completionAssigneeUid = await resolveAssigneeUid(familyId, assigneeAlias, idToken);
    if (!completionAssigneeUid || creditedCompletionUids.has(completionAssigneeUid)) {
      continue;
    }
    const canTrack = await userHasFamilyMembership(completionAssigneeUid, familyId, idToken);
    if (!canTrack) {
      continue;
    }
    creditedCompletionUids.add(completionAssigneeUid);
    const derivedMaximums = await computeCompletionDerivedMaximumsBestEffort({
      familyId,
      uid: completionAssigneeUid,
      idToken,
      completedAtIso: now,
    });
    await trackAchievementEventBestEffort({
      uid: completionAssigneeUid,
      familyId,
      idToken,
      viewerRole: "player",
      eventId: `chore_complete_${choreId}_${nextStatus}_${completionAssigneeUid}`,
      metricDeltas: {
        chores_completed: 1,
        coins_earned: payoutApplied ? (payoutByAssignee.get(assigneeAlias) ?? 0) : 0,
        morning_chores_completed: completionHour < 12 ? 1 : 0,
        evening_chores_completed: completionHour >= 18 ? 1 : 0,
        google_task_chores_completed: choreSource === GOOGLE_TASKS_CHORE_SOURCE ? 1 : 0,
        reopened_chores_completed: hadPriorSubmission ? 1 : 0,
      },
      metricMaximums: derivedMaximums,
      consumeRejectionFlagOnComplete: true,
    });
  }
  // Analytics: best-effort, observational, never blocks the transition. trackEvent
  // swallows its own failures. Emits the chore completion plus a coins_earned
  // event when a payout actually landed and identity_title_unlocked on a new
  // title, so feature-adoption questions are answerable without new code later.
  await trackEvent({
    event: ANALYTICS_EVENTS.chore_completed,
    familyId,
    userId: session.uid,
    role: requester.role,
    metadata: {
      choreId,
      status: nextStatus,
      requireApproval: completionNeedsApproval,
      coinValue: approvedCoinValue,
      source: choreSource || "manual",
      choreType,
      recurring: choreRecurrence.recurrenceType !== "none",
      routineStep: Boolean(choreRoutineAssignmentId),
    },
  });
  if (payoutApplied && approvedCoinValue > 0) {
    await trackEvent({
      event: ANALYTICS_EVENTS.coins_earned,
      familyId,
      userId: session.uid,
      role: requester.role,
      metadata: { choreId, coins: approvedCoinValue, source: "chore_completion" },
    });
  }
  if (responsibilityXp.title?.unlocked && responsibilityXp.title.pillar) {
    await trackEvent({
      event: ANALYTICS_EVENTS.identity_title_unlocked,
      familyId,
      userId: session.uid,
      role: requester.role,
      metadata: {
        pillar: responsibilityXp.title.pillar,
        tier: responsibilityXp.title.tier,
      },
    });
  }
  return {
    kind: "ok" as const,
    syncOwnerUid,
    newSkillBonus,
    responsibilityXp,
    routineProgress,
  };
}
