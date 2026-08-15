import { normalizeEmail } from "@/lib/auth/private-relay";
import { looksLikeEmail } from "@/lib/migration/email-keying-audit";
import type { ChoreAssigneeRecord } from "@/lib/migration/chore-assignee-rewrite";
import type { MemberRecord } from "@/lib/migration/email-keying-types";

/**
 * Plans expiry of unredeemed email-keyed invitations, plus whatever has to
 * happen to chores that were assigned to those people.
 *
 * Expiry deliberately mirrors what the product itself does, rather than hard
 * deleting:
 *  - member doc  -> `deleted: true` + `deletedAt` (as `DELETE /api/family/members/{memberId}`)
 *  - inviteLookup -> `status: "revoked"` (same route; the record is kept)
 *  - chore       -> `deleted: true` + `deletedAt` + `status: "Deleted"` (as
 *                   `DELETE /api/chores/{choreId}`)
 *
 * That is enough to end the migration exposure: `hasEmailMemberDoc()` in
 * firestore.rules requires `deleted != true`, so a soft-deleted email-keyed doc
 * grants nothing, and the sign-in cascade ignores a `revoked` inviteLookup. It
 * is also reversible, which a hard delete of another family's live invitation
 * would not be.
 *
 * A chore assigned to an expired invitee is only soft-deleted when they were
 * its ONLY assignee. If other people are still assigned, the chore survives and
 * just loses that one reference.
 */

export type InviteExpiry = {
  familyId: string;
  memberId: string;
  email: string;
  status: string;
  role: string;
};

export type InviteExpirySkip = {
  familyId: string;
  memberId: string;
  reason: "has_uid_counterpart" | "already_deleted" | "not_pending";
};

export type ChoreAction =
  | {
      kind: "soft_delete";
      familyId: string;
      choreId: string;
      status: string;
      reason: "only_assignee_expired";
    }
  | {
      kind: "remove_assignee";
      familyId: string;
      choreId: string;
      status: string;
      previousAssigneeId: string;
      nextAssigneeId: string;
      previousAssigneeIds: string[];
      nextAssigneeIds: string[];
    };

function isEmailKeyed(member: MemberRecord) {
  return looksLikeEmail(member.memberId);
}

export function planPendingInviteExpiry(input: {
  members: MemberRecord[];
  chores: ChoreAssigneeRecord[];
}) {
  const expiries: InviteExpiry[] = [];
  const skips: InviteExpirySkip[] = [];

  const uidKeyedByFamily = new Map<string, MemberRecord[]>();
  for (const member of input.members) {
    if (isEmailKeyed(member)) continue;
    const bucket = uidKeyedByFamily.get(member.familyId) ?? [];
    bucket.push(member);
    uidKeyedByFamily.set(member.familyId, bucket);
  }

  for (const member of input.members) {
    if (!isEmailKeyed(member)) continue;
    if (member.deleted) {
      skips.push({
        familyId: member.familyId,
        memberId: member.memberId,
        reason: "already_deleted",
      });
      continue;
    }
    if (member.status !== "invited" && member.status !== "claimed") {
      skips.push({ familyId: member.familyId, memberId: member.memberId, reason: "not_pending" });
      continue;
    }
    // A uid-keyed counterpart means this is a stale duplicate, not a live
    // invitation. Expiring it would be the wrong operation, so leave it.
    const key = normalizeEmail(member.memberId);
    const counterpart = (uidKeyedByFamily.get(member.familyId) ?? []).find(
      (candidate) => !candidate.deleted && normalizeEmail(candidate.email) === key,
    );
    if (counterpart) {
      skips.push({
        familyId: member.familyId,
        memberId: member.memberId,
        reason: "has_uid_counterpart",
      });
      continue;
    }
    expiries.push({
      familyId: member.familyId,
      memberId: member.memberId,
      email: normalizeEmail(member.email) || key,
      status: member.status,
      role: member.role,
    });
  }

  const expiredByFamily = new Map<string, Set<string>>();
  for (const expiry of expiries) {
    const bucket = expiredByFamily.get(expiry.familyId) ?? new Set<string>();
    bucket.add(normalizeEmail(expiry.memberId));
    bucket.add(normalizeEmail(expiry.email));
    expiredByFamily.set(expiry.familyId, bucket);
  }

  const choreActions: ChoreAction[] = [];
  for (const chore of input.chores) {
    if (chore.deleted) continue;
    const expired = expiredByFamily.get(chore.familyId);
    if (!expired) continue;

    const references = [chore.assigneeId, ...chore.assigneeIds].filter((value) =>
      expired.has(normalizeEmail(value)),
    );
    if (references.length === 0) continue;

    const nextAssigneeIds = chore.assigneeIds.filter(
      (value) => !expired.has(normalizeEmail(value)),
    );
    const assigneeIdExpired = expired.has(normalizeEmail(chore.assigneeId));
    const nextAssigneeId = assigneeIdExpired ? (nextAssigneeIds[0] ?? "") : chore.assigneeId;

    if (!nextAssigneeId && nextAssigneeIds.length === 0) {
      choreActions.push({
        kind: "soft_delete",
        familyId: chore.familyId,
        choreId: chore.choreId,
        status: chore.status,
        reason: "only_assignee_expired",
      });
      continue;
    }

    choreActions.push({
      kind: "remove_assignee",
      familyId: chore.familyId,
      choreId: chore.choreId,
      status: chore.status,
      previousAssigneeId: chore.assigneeId,
      nextAssigneeId,
      previousAssigneeIds: chore.assigneeIds,
      nextAssigneeIds,
    });
  }

  return { expiries, skips, choreActions };
}
