import {
  documentIdFromName,
  getDocument,
  listDocuments,
  readBoolean,
  readString,
  readStringArray,
} from "@/lib/firestore/rest";
import { normalizeEmail } from "@/lib/chores/input";
import { memoizePerRequest } from "@/lib/observability/request-context";

export type ViewerRole = "admin" | "player";

export type RequesterContext = {
  role: ViewerRole;
  assigneeAliases: Set<string>;
};

// Memoized per request: a single chore mutation resolved this ~10 times, and
// `users/{uid}.familyIds` cannot change midway through one request.
export async function getPrimaryFamilyId(uid: string, idToken: string) {
  return memoizePerRequest(`primaryFamilyId:${uid}`, async () => {
    const userDoc = await getDocument(`users/${uid}`, idToken);
    return readStringArray(userDoc.fields, "familyIds")[0] ?? "";
  });
}

export function isRequesterAssignee(
  assigneeId: string,
  uid: string,
  memberId: string,
  email: string,
) {
  if (!assigneeId) {
    return false;
  }
  if (assigneeId === uid || assigneeId === memberId) {
    return true;
  }
  const normalizedEmail = normalizeEmail(email);
  return Boolean(normalizedEmail) && normalizeEmail(assigneeId) === normalizedEmail;
}

export function toRole(value: string): ViewerRole {
  return value === "admin" ? "admin" : "player";
}

// Lightweight role lookup used by the list/create/reorder route.
export async function getViewerRole(
  familyId: string,
  uid: string,
  idToken: string,
): Promise<ViewerRole> {
  return memoizePerRequest(`viewerRole:${familyId}:${uid}`, () =>
    getViewerRoleUncached(familyId, uid, idToken),
  );
}

async function getViewerRoleUncached(
  familyId: string,
  uid: string,
  idToken: string,
): Promise<ViewerRole> {
  try {
    const memberDoc = await getDocument(`families/${familyId}/members/${uid}`, idToken);
    if (readBoolean(memberDoc.fields, "deleted")) {
      return "player";
    }
    return toRole(readString(memberDoc.fields, "role"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (!reason.includes("FIRESTORE_HTTP_404")) {
      throw error;
    }
  }

  const memberDocs = await listDocuments(`families/${familyId}/members`, idToken, 200);
  const memberByUid = memberDocs.find((doc) => {
    if (readBoolean(doc.fields, "deleted")) {
      return false;
    }
    return readString(doc.fields, "uid") === uid;
  });
  if (!memberByUid) {
    return "player";
  }
  return toRole(readString(memberByUid.fields, "role"));
}

// Resolves the requester's role plus every alias (uid, member doc id, email)
// that can identify them as a chore assignee. Used by the single-chore route to
// authorize self-service actions on the requester's own chores.
export async function getRequesterContext(
  familyId: string,
  uid: string,
  email: string,
  idToken: string,
): Promise<RequesterContext> {
  return memoizePerRequest(`requesterContext:${familyId}:${uid}:${email}`, () =>
    getRequesterContextUncached(familyId, uid, email, idToken),
  );
}

async function getRequesterContextUncached(
  familyId: string,
  uid: string,
  email: string,
  idToken: string,
): Promise<RequesterContext> {
  const aliases = new Set<string>([uid]);
  let role: ViewerRole = "player";
  let roleResolved = false;
  let emailMatchedRole: ViewerRole | null = null;
  const normalizedEmail = normalizeEmail(email);

  async function mergeMemberDoc(memberDocId: string) {
    if (!memberDocId) {
      return false;
    }
    try {
      const memberDoc = await getDocument(`families/${familyId}/members/${memberDocId}`, idToken);
      if (readBoolean(memberDoc.fields, "deleted")) {
        return false;
      }
      aliases.add(memberDocId);
      const memberUid = readString(memberDoc.fields, "uid");
      const memberEmail = normalizeEmail(readString(memberDoc.fields, "email"));
      if (memberUid) {
        aliases.add(memberUid);
      }
      if (memberEmail) {
        aliases.add(memberEmail);
      }
      if (!roleResolved) {
        role = toRole(readString(memberDoc.fields, "role"));
        roleResolved = true;
      }
      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "";
      if (reason.includes("FIRESTORE_HTTP_404")) {
        return false;
      }
      throw error;
    }
  }

  const foundUidMemberDoc = await mergeMemberDoc(uid);
  if (normalizedEmail && normalizedEmail !== uid) {
    await mergeMemberDoc(normalizedEmail);
  }

  if (!foundUidMemberDoc || !roleResolved) {
    const memberDocs = await listDocuments(`families/${familyId}/members`, idToken, 200);
    for (const doc of memberDocs) {
      if (readBoolean(doc.fields, "deleted")) {
        continue;
      }
      const memberId = documentIdFromName(doc.name);
      const memberUid = readString(doc.fields, "uid");
      const memberEmail = normalizeEmail(readString(doc.fields, "email"));
      const uidMatch = memberUid === uid;
      const emailMatch = normalizedEmail && memberEmail === normalizedEmail;
      if (!uidMatch && !emailMatch) {
        continue;
      }
      aliases.add(memberId);
      if (memberUid) {
        aliases.add(memberUid);
      }
      if (memberEmail) {
        aliases.add(memberEmail);
      }
      if (uidMatch) {
        role = toRole(readString(doc.fields, "role"));
        roleResolved = true;
      } else if (emailMatch && !emailMatchedRole) {
        emailMatchedRole = toRole(readString(doc.fields, "role"));
      }
    }
  }

  if (!roleResolved && emailMatchedRole) {
    role = emailMatchedRole;
  }

  return { role, assigneeAliases: aliases };
}
