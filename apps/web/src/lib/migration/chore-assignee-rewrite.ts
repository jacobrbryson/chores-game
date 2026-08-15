import { normalizeEmail } from "@/lib/auth/private-relay";
import { looksLikeEmail } from "@/lib/migration/email-keying-audit";
import type { MemberRecord } from "@/lib/migration/email-keying-types";

/**
 * Plans the rewrite of email-valued chore assignee references to uids
 * (`docs/release/sign-in-with-apple.md`, Phase 2 step 2).
 *
 * This is the step the Firestore rules suite exists to protect: get it wrong and
 * a child silently loses the ability to complete their own chores. So the rule
 * is deliberately narrow — a reference is rewritten ONLY when exactly one
 * non-deleted, uid-keyed member of that family carries that email. Ambiguity or
 * absence is a skip, never a guess.
 *
 * A chore assigned to someone who was invited but has not accepted CANNOT be
 * rewritten: no uid exists yet. Those must keep their email reference until the
 * invite is redeemed, and they are the reason the rules change cannot land on
 * data alone.
 */

export type ChoreAssigneeRecord = {
  familyId: string;
  choreId: string;
  status: string;
  deleted: boolean;
  assigneeId: string;
  assigneeIds: string[];
};

export type RewriteScope = "live" | "all";

export type AssigneeRewrite = {
  familyId: string;
  choreId: string;
  status: string;
  previousAssigneeId: string;
  nextAssigneeId: string;
  previousAssigneeIds: string[];
  nextAssigneeIds: string[];
  changedFields: Array<"assigneeId" | "assigneeIds">;
  mappings: Array<{ email: string; uid: string }>;
};

export type AssigneeSkip = {
  familyId: string;
  choreId: string;
  status: string;
  email: string;
  reason: "no_uid_keyed_member" | "ambiguous_members" | "out_of_scope";
};

/** A chore a player can still act on. Only these can break under the rules change. */
export function isLiveChore(chore: ChoreAssigneeRecord) {
  return !chore.deleted && (chore.status === "Open" || chore.status === "Submitted");
}

function resolveUid(familyId: string, email: string, members: MemberRecord[]) {
  const key = normalizeEmail(email);
  const candidates = members.filter(
    (member) =>
      member.familyId === familyId &&
      !member.deleted &&
      !looksLikeEmail(member.memberId) &&
      normalizeEmail(member.email) === key,
  );
  if (candidates.length === 1) {
    return { uid: candidates[0].memberId, reason: null as AssigneeSkip["reason"] | null };
  }
  return {
    uid: "",
    reason: (candidates.length === 0
      ? "no_uid_keyed_member"
      : "ambiguous_members") as AssigneeSkip["reason"],
  };
}

export function planChoreAssigneeRewrites(
  chores: ChoreAssigneeRecord[],
  membersByFamily: Map<string, MemberRecord[]>,
  scope: RewriteScope = "live",
) {
  const rewrites: AssigneeRewrite[] = [];
  const skips: AssigneeSkip[] = [];

  for (const chore of chores) {
    const emailsInDoc = [chore.assigneeId, ...chore.assigneeIds].filter((value) =>
      looksLikeEmail(value),
    );
    if (emailsInDoc.length === 0) continue;

    const members = membersByFamily.get(chore.familyId) ?? [];

    if (scope === "live" && !isLiveChore(chore)) {
      for (const email of [...new Set(emailsInDoc.map(normalizeEmail))]) {
        skips.push({
          familyId: chore.familyId,
          choreId: chore.choreId,
          status: chore.status,
          email,
          reason: "out_of_scope",
        });
      }
      continue;
    }

    const mappings: AssigneeRewrite["mappings"] = [];
    const unresolved = new Map<string, AssigneeSkip["reason"]>();
    for (const email of [...new Set(emailsInDoc.map(normalizeEmail))]) {
      const { uid, reason } = resolveUid(chore.familyId, email, members);
      if (uid) mappings.push({ email, uid });
      else if (reason) unresolved.set(email, reason);
    }

    for (const [email, reason] of unresolved) {
      skips.push({
        familyId: chore.familyId,
        choreId: chore.choreId,
        status: chore.status,
        email,
        reason,
      });
    }
    if (mappings.length === 0) continue;

    const uidByEmail = new Map(mappings.map((mapping) => [mapping.email, mapping.uid]));
    const mapValue = (value: string) =>
      looksLikeEmail(value) ? (uidByEmail.get(normalizeEmail(value)) ?? value) : value;

    const nextAssigneeId = mapValue(chore.assigneeId);
    // Preserve order, drop duplicates that appear once the email collapses onto
    // a uid already present in the list.
    const nextAssigneeIds = [...new Set(chore.assigneeIds.map(mapValue))];

    const changedFields: AssigneeRewrite["changedFields"] = [];
    if (nextAssigneeId !== chore.assigneeId) changedFields.push("assigneeId");
    if (
      nextAssigneeIds.length !== chore.assigneeIds.length ||
      nextAssigneeIds.some((value, index) => value !== chore.assigneeIds[index])
    ) {
      changedFields.push("assigneeIds");
    }
    if (changedFields.length === 0) continue;

    rewrites.push({
      familyId: chore.familyId,
      choreId: chore.choreId,
      status: chore.status,
      previousAssigneeId: chore.assigneeId,
      nextAssigneeId,
      previousAssigneeIds: chore.assigneeIds,
      nextAssigneeIds,
      changedFields,
      mappings,
    });
  }

  return { rewrites, skips };
}

/** Number of individual email-valued references, which exceeds the chore count. */
export function countEmailRefs(chores: ChoreAssigneeRecord[]) {
  return chores.reduce(
    (total, chore) =>
      total +
      [chore.assigneeId, ...chore.assigneeIds].filter((value) => looksLikeEmail(value)).length,
    0,
  );
}
