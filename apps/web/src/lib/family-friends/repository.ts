import {
  adminGetDocument,
  adminListAllDocuments,
  adminRunQuery,
} from "@/lib/firestore/admin";
import {
  documentIdFromName,
  readBoolean,
  readString,
  readStringArray,
  readTimestamp,
  type FirestoreDocument,
} from "@/lib/firestore/rest";

export type FamilyFriendRecord = {
  familyId: string;
  familyName: string;
  connectedAt: string;
};

export type FamilyFriendInviteRecord = {
  id: string;
  status: string;
  fromFamilyId: string;
  fromFamilyName: string;
  fromAdminUid: string;
  fromAdminName: string;
  fromAdminEmail: string;
  toEmail: string;
  toFamilyId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string;
};

function inviteFromDoc(doc: FirestoreDocument): FamilyFriendInviteRecord {
  return {
    id: documentIdFromName(doc.name),
    status: readString(doc.fields, "status"),
    fromFamilyId: readString(doc.fields, "fromFamilyId"),
    fromFamilyName: readString(doc.fields, "fromFamilyName"),
    fromAdminUid: readString(doc.fields, "fromAdminUid"),
    fromAdminName: readString(doc.fields, "fromAdminName"),
    fromAdminEmail: readString(doc.fields, "fromAdminEmail"),
    toEmail: readString(doc.fields, "toEmail"),
    toFamilyId: readString(doc.fields, "toFamilyId"),
    tokenHash: readString(doc.fields, "tokenHash"),
    createdAt: readTimestamp(doc.fields, "createdAt"),
    expiresAt: readTimestamp(doc.fields, "expiresAt"),
    acceptedAt: readTimestamp(doc.fields, "acceptedAt"),
  };
}

export async function getFamilyFriendInvite(inviteId: string) {
  try {
    return inviteFromDoc(await adminGetDocument(`familyFriendInvites/${inviteId}`));
  } catch (error) {
    if (error instanceof Error && error.message.includes("FIRESTORE_ADMIN_HTTP_404")) {
      return null;
    }
    throw error;
  }
}

export async function listFamilyFriends(familyId: string): Promise<FamilyFriendRecord[]> {
  const docs = await adminListAllDocuments(`families/${familyId}/friends`, { cap: 100 });
  return docs
    .filter((doc) => !readBoolean(doc.fields, "deleted") && readString(doc.fields, "status") === "active")
    .map((doc) => ({
      familyId: documentIdFromName(doc.name),
      familyName: readString(doc.fields, "friendFamilyName") || "Family friend",
      connectedAt: readTimestamp(doc.fields, "connectedAt"),
    }));
}

export async function listFamilyFriendInvites(familyId: string, adminEmail: string) {
  const [outgoingDocs, incomingDocs] = await Promise.all([
    adminRunQuery({
      from: [{ collectionId: "familyFriendInvites" }],
      where: { fieldFilter: { field: { fieldPath: "fromFamilyId" }, op: "EQUAL", value: { stringValue: familyId } } },
      limit: 100,
    }),
    adminRunQuery({
      from: [{ collectionId: "familyFriendInvites" }],
      where: { fieldFilter: { field: { fieldPath: "toEmail" }, op: "EQUAL", value: { stringValue: adminEmail } } },
      limit: 100,
    }),
  ]);
  return {
    outgoing: outgoingDocs.map(inviteFromDoc),
    incoming: incomingDocs.map(inviteFromDoc),
  };
}

export async function findTargetAdminFamily(email: string) {
  // Resolve through the top-level user record first. Querying every family's
  // members subcollection by email requires a collection-group index and makes
  // invitations fail with FIRESTORE_ADMIN_HTTP_400 when that optional index is
  // not deployed. User email is already a normal single-collection index, and
  // the resolved membership is still verified below before any data is shared.
  const users = await adminRunQuery({
    from: [{ collectionId: "users" }],
    where: { fieldFilter: { field: { fieldPath: "email" }, op: "EQUAL", value: { stringValue: email } } },
    limit: 5,
  });
  for (const user of users) {
    const uid = readString(user.fields, "uid") || documentIdFromName(user.name);
    for (const familyId of readStringArray(user.fields, "familyIds")) {
      let member: FirestoreDocument | null = null;
      try {
        member = await adminGetDocument(`families/${familyId}/members/${uid}`);
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("FIRESTORE_ADMIN_HTTP_404")) {
          throw error;
        }
      }
      if (
        !member ||
        readBoolean(member.fields, "deleted") ||
        readString(member.fields, "status") !== "active" ||
        readString(member.fields, "role") !== "admin"
      ) {
        continue;
      }

      let familyName = "Family friend";
      let locale = readString(user.fields, "locale") || "en-US";
      try {
        const familyDoc = await adminGetDocument(`families/${familyId}`);
        familyName = readString(familyDoc.fields, "name") || familyName;
        locale = readString(familyDoc.fields, "defaultLocale") || locale;
      } catch {
        // Presentation metadata is best effort; the verified admin membership is authoritative.
      }
      return {
        familyId,
        familyName,
        uid,
        name: readString(member.fields, "name") || readString(user.fields, "displayName") || email,
        email,
        locale,
      };
    }
  }
  return null;
}
