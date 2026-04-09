import {
  documentIdFromName,
  findFirstFamilyIdByMemberEmail,
  findFirstFamilyIdByMemberUid,
  getDocument,
  listDocuments,
  readBoolean,
  readString,
  readStringArray,
  readTimestamp,
} from "@/lib/firestore/rest";

export type ViewerRole = "admin" | "player";

export type FamilyResolvedMember = {
  id: string;
  uid?: string;
  name: string;
  email: string;
  role: "admin" | "player";
  status: "active" | "invited";
  lastSignInAt?: string;
  dashboardPrimaryColor?: string;
  avatarId?: string;
  avatarPhotoUrl?: string;
  selectedConfettiOptionId?: string;
  createdBy?: string;
  createdAt?: string;
};

export type ViewerFamilyContext = {
  familyId: string;
  familyName: string;
  members: FamilyResolvedMember[];
  viewerMember: FamilyResolvedMember | null;
  viewerRole: ViewerRole;
};

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function toMemberRole(value: string): FamilyResolvedMember["role"] {
  return value === "admin" ? "admin" : "player";
}

function toMemberStatus(value: string): FamilyResolvedMember["status"] {
  return value === "active" ? "active" : "invited";
}

function toUnixMillis(value?: string) {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export async function getPrimaryFamilyIdWithFallback(
  uid: string,
  email: string,
  idToken: string,
) {
  try {
    const userDoc = await getDocument(`users/${uid}`, idToken);
    const fromUser = readStringArray(userDoc.fields, "familyIds")[0] ?? "";
    if (fromUser) {
      return fromUser;
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (!reason.includes("FIRESTORE_HTTP_404")) {
      throw error;
    }
  }

  const byUid = await findFirstFamilyIdByMemberUid(uid, idToken);
  if (byUid) {
    return byUid;
  }

  return findFirstFamilyIdByMemberEmail(email, idToken);
}

export async function listFamilyMembers(
  familyId: string,
  idToken: string,
  pageSize = 200,
): Promise<FamilyResolvedMember[]> {
  const memberDocs = await listDocuments(`families/${familyId}/members`, idToken, pageSize);

  return memberDocs
    .map((doc) => ({
      id: documentIdFromName(doc.name),
      uid: readString(doc.fields, "uid") || undefined,
      name: readString(doc.fields, "name") || "Unnamed member",
      email: readString(doc.fields, "email"),
      role: toMemberRole(readString(doc.fields, "role")),
      status: toMemberStatus(readString(doc.fields, "status")),
      lastSignInAt: readTimestamp(doc.fields, "lastSignInAt") || undefined,
      dashboardPrimaryColor: readString(doc.fields, "dashboardPrimaryColor") || undefined,
      avatarId: readString(doc.fields, "avatarId") || undefined,
      avatarPhotoUrl: readString(doc.fields, "avatarPhotoUrl") || undefined,
      selectedConfettiOptionId:
        readString(doc.fields, "selectedConfettiOptionId") || undefined,
      createdBy: readString(doc.fields, "createdBy") || undefined,
      createdAt: readTimestamp(doc.fields, "createdAt") || undefined,
      deleted: readBoolean(doc.fields, "deleted"),
    }))
    .filter((member) => !member.deleted)
    .filter((member, _index, members) => {
      if (member.uid) {
        return true;
      }
      const normalizedEmail = normalizeEmail(member.email);
      if (!normalizedEmail) {
        return true;
      }
      return !members.some(
        (candidate) =>
          Boolean(candidate.uid) &&
          normalizeEmail(candidate.email) === normalizedEmail,
      );
    })
    .sort((a, b) => {
      const bySignIn = toUnixMillis(b.lastSignInAt) - toUnixMillis(a.lastSignInAt);
      if (bySignIn !== 0) {
        return bySignIn;
      }
      return a.name.localeCompare(b.name);
    })
    .map(({ deleted: _deleted, ...member }) => member);
}

export async function getViewerFamilyContext(
  uid: string,
  email: string,
  idToken: string,
): Promise<ViewerFamilyContext> {
  const familyId = await getPrimaryFamilyIdWithFallback(uid, email, idToken);
  if (!familyId) {
    return {
      familyId: "",
      familyName: "",
      members: [],
      viewerMember: null,
      viewerRole: "player",
    };
  }

  let familyName = "My Family";
  try {
    const familyDoc = await getDocument(`families/${familyId}`, idToken);
    familyName = readString(familyDoc.fields, "name") || familyName;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (!reason.includes("FIRESTORE_HTTP_404")) {
      throw error;
    }
  }

  const members = await listFamilyMembers(familyId, idToken);
  const normalizedEmail = normalizeEmail(email);
  const viewerMember =
    members.find((member) => member.uid === uid || member.id === uid) ??
    members.find((member) => normalizeEmail(member.email) === normalizedEmail) ??
    null;

  return {
    familyId,
    familyName,
    members,
    viewerMember,
    viewerRole: viewerMember?.role ?? "player",
  };
}

export function resolveFamilyMemberByIdentifier(
  members: FamilyResolvedMember[],
  identifier: string,
) {
  const normalizedIdentifier = normalizeEmail(identifier);
  return (
    members.find((member) => member.id === identifier || member.uid === identifier) ??
    members.find((member) => normalizeEmail(member.email) === normalizedIdentifier) ??
    null
  );
}

export function canViewerAccessFamilyMember(
  viewerRole: ViewerRole,
  viewerUid: string,
  viewerEmail: string,
  member: FamilyResolvedMember,
) {
  if (viewerRole === "admin") {
    return true;
  }

  if (member.uid === viewerUid || member.id === viewerUid) {
    return true;
  }

  return normalizeEmail(member.email) === normalizeEmail(viewerEmail);
}
