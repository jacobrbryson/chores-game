import { applyWalletDelta } from "@/lib/economy/wallet";
import { claimNewSkillBonus, NEW_SKILL_BONUS_AMOUNT } from "@/lib/chores/skill-bonus";
import { resolveAssigneeUid } from "@/lib/chores/assignees";

export type NewSkillBonusOutcome = {
  awarded: boolean;
  amount: number;
  totalCoins: number;
  playerUids: string[];
};

export const EMPTY_NEW_SKILL_BONUS: NewSkillBonusOutcome = {
  awarded: false,
  amount: NEW_SKILL_BONUS_AMOUNT,
  totalCoins: 0,
  playerUids: [],
};

// Awards the one-time New Skill Bonus to every assignee being paid for the
// first completion of this chore identity. The durable claim record makes it
// idempotent: retries, websocket replays and double-approvals resolve to no
// additional payout. Best-effort — never throws into the completion flow.
export async function awardNewSkillBonuses(params: {
  familyId: string;
  idToken: string;
  rootChoreId: string;
  payoutByAssignee: Map<string, number>;
  sourceCompletionId: string;
}): Promise<NewSkillBonusOutcome> {
  const { familyId, idToken, rootChoreId, payoutByAssignee, sourceCompletionId } = params;
  if (!rootChoreId) {
    return EMPTY_NEW_SKILL_BONUS;
  }
  let totalCoins = 0;
  const playerUids: string[] = [];
  const seenUids = new Set<string>();
  for (const [assigneeAlias, coins] of payoutByAssignee.entries()) {
    if (coins <= 0) {
      continue;
    }
    const assigneeUid = await resolveAssigneeUid(familyId, assigneeAlias, idToken);
    if (!assigneeUid || seenUids.has(assigneeUid)) {
      continue;
    }
    seenUids.add(assigneeUid);
    try {
      const { firstTime } = await claimNewSkillBonus({
        familyId,
        playerUid: assigneeUid,
        rootChoreId,
        sourceCompletionId,
        idToken,
      });
      if (!firstTime) {
        continue;
      }
      await applyWalletDelta({
        uid: assigneeUid,
        idToken,
        delta: NEW_SKILL_BONUS_AMOUNT,
        reason: "new_skill_bonus",
        choreId: rootChoreId,
        debugMeta: { familyId, rootChoreId, sourceCompletionId, assigneeAlias },
      });
      totalCoins += NEW_SKILL_BONUS_AMOUNT;
      playerUids.push(assigneeUid);
    } catch (error) {
      const reason = error instanceof Error && error.message ? error.message.slice(0, 200) : "unknown";
      console.error("[NEW_SKILL_BONUS_AWARD_ERROR]", {
        familyId,
        rootChoreId,
        assigneeUid,
        reason,
      });
    }
  }
  return {
    awarded: playerUids.length > 0,
    amount: NEW_SKILL_BONUS_AMOUNT,
    totalCoins,
    playerUids,
  };
}

// Resolves the distinct player uids that actually received coins for this
// completion, used to attribute Responsibility XP at the same lifecycle point
// as the payout itself.
export async function resolvePaidPlayerUids(
  familyId: string,
  payoutByAssignee: Map<string, number>,
  idToken: string,
) {
  const uids = new Set<string>();
  for (const [assigneeAlias, coins] of payoutByAssignee.entries()) {
    if (coins <= 0) {
      continue;
    }
    const assigneeUid = await resolveAssigneeUid(familyId, assigneeAlias, idToken);
    if (assigneeUid) {
      uids.add(assigneeUid);
    }
  }
  return Array.from(uids);
}
