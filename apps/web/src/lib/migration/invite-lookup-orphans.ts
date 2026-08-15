import { normalizeEmail } from "@/lib/auth/private-relay";
import type { MemberRecord } from "@/lib/migration/email-keying-types";

/**
 * Decides which `inviteLookup/{email}` index documents are orphans left behind
 * by an invite that was already accepted.
 *
 * Pure, and deliberately conservative: the cleanup script re-derives this at run
 * time from live data and deletes ONLY what this function returns. It never
 * accepts a precomputed list, so a stale audit report can never drive a delete.
 *
 * An `inviteLookup` record is an orphan only when ALL of these hold:
 *
 *  1. Its `familyId` names a family document that exists and is not deleted.
 *     A lookup pointing at a missing family is left alone — that is orphaned
 *     family data needing a human decision, not routine cleanup.
 *  2. There is no `members/{email}` document in that family. If one exists the
 *     invite is still live and the lookup is load-bearing: `lib/auth/idp-signin`
 *     reads it to resolve the family at sign-in.
 *  3. Some non-deleted, `active` member doc in that family carries the same
 *     email — i.e. the person demonstrably accepted and is uid-keyed now.
 *
 * Condition 3 is what makes deletion safe: the membership survives in the
 * uid-keyed doc, so removing the index loses nothing.
 */

export type InviteLookupRow = {
  docId: string;
  email: string;
  familyId: string;
  status: string;
};

export type FamilyExistence = {
  familyId: string;
  exists: boolean;
  deleted: boolean;
};

export type OrphanVerdict =
  | { docId: string; orphan: true; familyId: string; acceptedMemberId: string }
  | { docId: string; orphan: false; familyId: string; reason: OrphanSkipReason };

export type OrphanSkipReason =
  | "family_missing"
  | "family_deleted"
  | "email_member_doc_still_exists"
  | "no_accepted_member"
  | "no_family_id";

export function classifyInviteLookup(
  row: InviteLookupRow,
  families: Map<string, FamilyExistence>,
  membersByFamily: Map<string, MemberRecord[]>,
): OrphanVerdict {
  const familyId = row.familyId.trim();
  if (!familyId) {
    return { docId: row.docId, orphan: false, familyId, reason: "no_family_id" };
  }

  const family = families.get(familyId);
  if (!family?.exists) {
    return { docId: row.docId, orphan: false, familyId, reason: "family_missing" };
  }
  if (family.deleted) {
    return { docId: row.docId, orphan: false, familyId, reason: "family_deleted" };
  }

  const key = normalizeEmail(row.docId);
  const members = membersByFamily.get(familyId) ?? [];

  const emailKeyedDoc = members.find((member) => normalizeEmail(member.memberId) === key);
  if (emailKeyedDoc) {
    return {
      docId: row.docId,
      orphan: false,
      familyId,
      reason: "email_member_doc_still_exists",
    };
  }

  const accepted = members.find(
    (member) =>
      !member.deleted &&
      member.status === "active" &&
      normalizeEmail(member.email) === key &&
      normalizeEmail(member.memberId) !== key,
  );
  if (!accepted) {
    return { docId: row.docId, orphan: false, familyId, reason: "no_accepted_member" };
  }

  return { docId: row.docId, orphan: true, familyId, acceptedMemberId: accepted.memberId };
}

export function classifyInviteLookups(
  rows: InviteLookupRow[],
  families: Map<string, FamilyExistence>,
  membersByFamily: Map<string, MemberRecord[]>,
) {
  return rows.map((row) => classifyInviteLookup(row, families, membersByFamily));
}
