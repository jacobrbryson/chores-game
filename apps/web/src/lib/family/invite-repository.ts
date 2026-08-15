import {
  adminCreateOrReplaceDocument,
  adminGetDocument,
  adminPatchDocument,
  adminRunQuery,
} from "@/lib/firestore/admin";
import {
  documentIdFromName,
  integerField,
  readInteger,
  readString,
  readTimestamp,
  stringField,
  timestampField,
  type FirestoreDocument,
} from "@/lib/firestore/rest";
import {
  familyInviteCodeMatches,
  familyInviteExpiresAt,
  hashFamilyInviteCode,
  type FamilyInviteStatus,
} from "@/lib/family/invite-tokens";

/**
 * `familyInvites` is a top-level, server-only collection (the catch-all deny in
 * firestore.rules covers it). It is read and written exclusively with admin
 * credentials because redemption happens *before* the redeemer is a member of
 * the family — they have no membership a user-scoped token could be checked
 * against. Classification: ADMIN_ONLY.
 */
const COLLECTION = "familyInvites";

export type FamilyInviteRecord = {
  id: string;
  familyId: string;
  familyName: string;
  memberId: string;
  invitedName: string;
  /** Family-visible address. Empty for private-relay or codeless invites. */
  invitedEmail: string;
  role: "admin" | "player";
  status: FamilyInviteStatus;
  codeHash: string;
  createdByUid: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string;
  acceptedByUid: string;
  acceptedByEmail: string;
  attemptCount: number;
};

function inviteFromDoc(doc: FirestoreDocument): FamilyInviteRecord {
  return {
    id: documentIdFromName(doc.name),
    familyId: readString(doc.fields, "familyId"),
    familyName: readString(doc.fields, "familyName"),
    memberId: readString(doc.fields, "memberId"),
    invitedName: readString(doc.fields, "invitedName"),
    invitedEmail: readString(doc.fields, "invitedEmail"),
    role: readString(doc.fields, "role") === "admin" ? "admin" : "player",
    status: (readString(doc.fields, "status") || "pending") as FamilyInviteStatus,
    codeHash: readString(doc.fields, "codeHash"),
    createdByUid: readString(doc.fields, "createdByUid"),
    createdAt: readTimestamp(doc.fields, "createdAt"),
    expiresAt: readTimestamp(doc.fields, "expiresAt"),
    acceptedAt: readTimestamp(doc.fields, "acceptedAt"),
    acceptedByUid: readString(doc.fields, "acceptedByUid"),
    acceptedByEmail: readString(doc.fields, "acceptedByEmail"),
    attemptCount: readInteger(doc.fields, "attemptCount"),
  };
}

export type CreateFamilyInviteInput = {
  inviteId: string;
  code: string;
  familyId: string;
  familyName: string;
  memberId: string;
  invitedName: string;
  invitedEmail: string;
  role: "admin" | "player";
  createdByUid: string;
  now?: string;
};

export async function createFamilyInvite(input: CreateFamilyInviteInput) {
  const now = input.now ?? new Date().toISOString();
  const expiresAt = familyInviteExpiresAt(new Date(now));
  await adminCreateOrReplaceDocument(`${COLLECTION}/${input.inviteId}`, {
    familyId: stringField(input.familyId),
    familyName: stringField(input.familyName),
    memberId: stringField(input.memberId),
    invitedName: stringField(input.invitedName),
    invitedEmail: stringField(input.invitedEmail),
    role: stringField(input.role),
    status: stringField("pending"),
    // Only the hash is persisted; the raw code is returned to the inviting
    // parent once and never read back.
    codeHash: stringField(hashFamilyInviteCode(input.code)),
    createdByUid: stringField(input.createdByUid),
    createdAt: timestampField(now),
    expiresAt: timestampField(expiresAt),
    acceptedAt: stringField(""),
    acceptedByUid: stringField(""),
    acceptedByEmail: stringField(""),
    attemptCount: integerField(0),
  });
  return { inviteId: input.inviteId, expiresAt };
}

/**
 * Resolves a typed code to its invite. The lookup is a single-field equality
 * query on the hash (no composite index needed), and the hash is re-verified in
 * constant time so a partial index scan cannot be used as an oracle.
 */
export async function findFamilyInviteByCode(code: string) {
  const docs = await adminRunQuery({
    from: [{ collectionId: COLLECTION }],
    where: {
      fieldFilter: {
        field: { fieldPath: "codeHash" },
        op: "EQUAL",
        value: { stringValue: hashFamilyInviteCode(code) },
      },
    },
    limit: 2,
  });
  const matched = docs
    .map(inviteFromDoc)
    .find((invite) => familyInviteCodeMatches(code, invite.codeHash));
  return matched ?? null;
}

export async function getFamilyInvite(inviteId: string) {
  try {
    return inviteFromDoc(await adminGetDocument(`${COLLECTION}/${inviteId}`));
  } catch (error) {
    if (error instanceof Error && error.message.includes("FIRESTORE_ADMIN_HTTP_404")) {
      return null;
    }
    throw error;
  }
}

export async function listFamilyInvites(familyId: string) {
  const docs = await adminRunQuery({
    from: [{ collectionId: COLLECTION }],
    where: {
      fieldFilter: {
        field: { fieldPath: "familyId" },
        op: "EQUAL",
        value: { stringValue: familyId },
      },
    },
    limit: 200,
  });
  return docs.map(inviteFromDoc);
}

export async function markFamilyInviteAccepted(input: {
  inviteId: string;
  acceptedByUid: string;
  acceptedByEmail: string;
  now?: string;
}) {
  const now = input.now ?? new Date().toISOString();
  await adminPatchDocument(
    `${COLLECTION}/${input.inviteId}`,
    {
      status: stringField("accepted"),
      acceptedAt: timestampField(now),
      acceptedByUid: stringField(input.acceptedByUid),
      acceptedByEmail: stringField(input.acceptedByEmail),
    },
    ["status", "acceptedAt", "acceptedByUid", "acceptedByEmail"],
  );
}

export async function revokeFamilyInvite(inviteId: string) {
  await adminPatchDocument(`${COLLECTION}/${inviteId}`, { status: stringField("revoked") }, [
    "status",
  ]);
}

/** Records a failed redemption so a guessed code cannot be brute-forced forever. */
export async function recordFamilyInviteAttempt(inviteId: string, attemptCount: number) {
  await adminPatchDocument(
    `${COLLECTION}/${inviteId}`,
    { attemptCount: integerField(attemptCount + 1) },
    ["attemptCount"],
  );
}
