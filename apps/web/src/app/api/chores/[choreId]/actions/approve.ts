import {
  getDocument,
  integerField,
  patchDocument,
  readBoolean,
  readInteger,
  readString,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";
import { publishFamilyActivity } from "@/lib/ws/publish-family-activity";
import { writeAuditLogBestEffort } from "@/lib/audit/log";
import { normalizeCoinValue } from "@/lib/chores/recurrence";
import { canonicalRecurringChoreId } from "@/lib/chores/skill-bonus";
import { awardChoreResponsibilityXpBestEffort } from "@/lib/responsibility/service";
import { recordRoutineStepCompletionBestEffort } from "@/lib/responsibility/assignment-service";
import { getRequesterContext } from "@/lib/chores/access";
import { resolveAssigneeUid, resolveChoreAssigneeIds, userHasFamilyMembership } from "@/lib/chores/assignees";
import { applyPayoutByAssignee, buildPayoutByAssignee } from "@/lib/chores/payouts";
import {
  awardNewSkillBonuses,
  resolvePaidPlayerUids,
  type NewSkillBonusOutcome,
} from "@/lib/chores/bonus-award";
import { resolveStoredNewSkillEnabled } from "@/lib/chores/input";
import {
  describeRoutineStepContext,
  emitFamilyActivityBestEffort,
  trackAchievementEventBestEffort,
} from "@/lib/chores/activity-helpers";
import {
  EMPTY_RESPONSIBILITY_XP,
  type ChoreActionContext,
  type ChoreActionOutcome,
} from "./context";

export async function handleApprove(ctx: ChoreActionContext): Promise<ChoreActionOutcome> {
  const { familyId, idToken, session, choreId, now, actorName, body } = ctx;
  const requester = await getRequesterContext(familyId, session.uid, session.email, idToken);
  if (requester.role !== "admin") {
    return { kind: "forbidden_action" as const };
  }
  const existingChoreDoc = await getDocument(`families/${familyId}/chores/${choreId}`, idToken);
  const currentStatus = readString(existingChoreDoc.fields, "status") || "Open";
  const choreTitle = readString(existingChoreDoc.fields, "title") || "Untitled chore";
  const choreAssigneeId = readString(existingChoreDoc.fields, "assigneeId");
  const choreAssigneeIds = await resolveChoreAssigneeIds(familyId, existingChoreDoc.fields, idToken);
  const choreCoinValue = normalizeCoinValue(readInteger(existingChoreDoc.fields, "coinValue"));
  const choreRequireApproval = readBoolean(existingChoreDoc.fields, "requireApproval");
  const choreNewSkillEnabled = resolveStoredNewSkillEnabled(existingChoreDoc.fields);
  const rootChoreId = canonicalRecurringChoreId(existingChoreDoc.fields, choreId);
  if (currentStatus !== "Submitted" || !choreRequireApproval) {
    return { kind: "invalid_transition" as const };
  }
  const payoutByAssignee = buildPayoutByAssignee({
    assigneeIds: choreAssigneeIds,
    totalCoinValue: choreCoinValue,
    overrides: body.approvalPayouts,
  });
  const approvedCoinValue = Array.from(payoutByAssignee.values()).reduce(
    (total, coins) => total + Math.max(0, Math.trunc(coins || 0)),
    0,
  );
  await patchDocument(
    `families/${familyId}/chores/${choreId}`,
    {
      status: stringField("Approved"),
      approvalPayoutsJson: stringField(
        JSON.stringify(
          Array.from(payoutByAssignee.entries()).map(([assigneeId, coinValue]) => ({
            assigneeId,
            coinValue,
          })),
        ),
      ),
      coinValue: integerField(approvedCoinValue),
      updatedAt: timestampField(now),
    },
    idToken,
    ["status", "approvalPayoutsJson", "coinValue", "updatedAt"],
  );
  await writeAuditLogBestEffort({
    familyId,
    idToken,
    eventType: "chore_status_changed",
    actor: { uid: session.uid, email: session.email, name: actorName, role: requester.role },
    userId: choreAssigneeId,
    choreId,
    choreTitle,
    source: readString(existingChoreDoc.fields, "source") || "manual",
    previous: { status: currentStatus, coinValue: choreCoinValue },
    next: { status: "Approved", coinValue: approvedCoinValue },
    reason: "approve",
  });
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
  const payoutApplied = payoutResult.kind === "ok" && payoutResult.anyApplied;
  let newSkillBonus: NewSkillBonusOutcome = {
    awarded: false,
    amount: 0,
    totalCoins: 0,
    playerUids: [],
  };
  if (choreNewSkillEnabled) {
    newSkillBonus = await awardNewSkillBonuses({
      familyId,
      idToken,
      rootChoreId,
      payoutByAssignee,
      sourceCompletionId: choreId,
    });
  }
  const responsibilityXp = await awardChoreResponsibilityXpBestEffort({
    familyId,
    idToken,
    choreId,
    choreFields: existingChoreDoc.fields,
    paidPlayerUids: await resolvePaidPlayerUids(familyId, payoutByAssignee, idToken),
    newSkillPlayerUids: newSkillBonus.playerUids,
  });
  // Approval is the payout point for approval-required routine steps, so routine
  // progress (and the completion bonus on the final step) is recorded here.
  const routineProgress = await recordRoutineStepCompletionBestEffort({
    familyId,
    idToken,
    choreId,
    choreFields: existingChoreDoc.fields,
    playerUid: (await resolveAssigneeUid(familyId, choreAssigneeId, idToken)) || "",
    actor: { uid: session.uid, email: session.email, name: actorName },
  });
  await emitFamilyActivityBestEffort({
    familyId,
    idToken,
    kind: "chore_approved",
    actorUid: session.uid,
    actorEmail: session.email,
    actorName,
    title: "Chore approved",
    message: `${actorName} approved "${choreTitle}"${describeRoutineStepContext(existingChoreDoc.fields)}${payoutApplied ? " and paid coins" : ""}.${newSkillBonus.awarded ? ` 🎉 New Skill Learned (+${newSkillBonus.totalCoins} bonus coins)!` : ""}`,
    choreId,
    choreTitle,
    relatedIds: choreAssigneeId ? [choreAssigneeId] : [],
    newSkillBonusAwarded: newSkillBonus.awarded,
    newSkillBonusAmount: newSkillBonus.totalCoins,
  });
  await publishFamilyActivity({ type: "chore_updated", familyId, choreId, occurredAt: now });
  await trackAchievementEventBestEffort({
    uid: session.uid,
    familyId,
    idToken,
    viewerRole: "admin",
    eventId: `chore_approve_${choreId}`,
    metricDeltas: { admin_chores_approved: 1 },
  });
  try {
    for (const assigneeAlias of choreAssigneeIds) {
      const assigneeUid = await resolveAssigneeUid(familyId, assigneeAlias, idToken);
      if (!assigneeUid) {
        continue;
      }
      const canTrack = await userHasFamilyMembership(assigneeUid, familyId, idToken);
      if (!canTrack) {
        continue;
      }
      await trackAchievementEventBestEffort({
        uid: assigneeUid,
        familyId,
        idToken,
        viewerRole: "player",
        eventId: `chore_approved_${choreId}_${assigneeUid}`,
        metricDeltas: {
          chores_approved: 1,
          coins_earned: payoutByAssignee.get(assigneeAlias) ?? 0,
        },
        approvalStreakDelta: "increment",
      });
    }
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[ACHIEVEMENT_TRACK_AFTER_CHORE_ERROR]", reason);
  }
  return {
    kind: "ok" as const,
    syncOwnerUid: "",
    newSkillBonus,
    responsibilityXp: responsibilityXp ?? EMPTY_RESPONSIBILITY_XP,
    routineProgress,
  };
}
