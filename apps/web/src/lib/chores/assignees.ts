import {
  documentIdFromName,
  getDocument,
  listAllDocuments,
  listDocuments,
  readBoolean,
  readString,
  readStringArray,
  type FirestoreValue,
} from "@/lib/firestore/rest";
import { resolveMemberPrimaryColor } from "@/lib/theme/member-primary-color";
import { normalizeEmail } from "@/lib/chores/input";
import { memoizePerRequest } from "@/lib/observability/request-context";

const MAX_CHORE_SCAN = 5000;

export async function getFamilyMemberName(
  familyId: string,
  memberId: string,
  idToken: string,
  fallbackName = "Unassigned",
) {
  try {
    const memberDoc = await getDocument(`families/${familyId}/members/${memberId}`, idToken);
    return readString(memberDoc.fields, "name") || fallbackName;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("FIRESTORE_HTTP_404")) {
      return fallbackName;
    }
    throw error;
  }
}

// Finds a member doc that matches assigneeId by doc id, uid, or email and runs
// `select` against its fields. Falls back to scanning the member list when the
// direct lookup misses. Shared by the avatar/color/uid resolvers below.
async function resolveFromMember<T>(
  familyId: string,
  assigneeId: string,
  idToken: string,
  select: (fields: Record<string, FirestoreValue> | undefined) => T,
): Promise<T | undefined> {
  if (!assigneeId) {
    return undefined;
  }
  try {
    const memberDoc = await getDocument(`families/${familyId}/members/${assigneeId}`, idToken);
    if (readBoolean(memberDoc.fields, "deleted")) {
      return undefined;
    }
    return select(memberDoc.fields);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (!reason.includes("FIRESTORE_HTTP_404")) {
      throw error;
    }
  }

  const memberDocs = await listDocuments(`families/${familyId}/members`, idToken, 100);
  const normalizedAssignee = normalizeEmail(assigneeId);
  const matchedMember = memberDocs.find((doc) => {
    if (readBoolean(doc.fields, "deleted")) {
      return false;
    }
    const memberId = documentIdFromName(doc.name);
    if (memberId === assigneeId) {
      return true;
    }
    const memberUid = readString(doc.fields, "uid");
    if (memberUid && memberUid === assigneeId) {
      return true;
    }
    const memberEmail = normalizeEmail(readString(doc.fields, "email"));
    return Boolean(memberEmail) && memberEmail === normalizedAssignee;
  });
  if (!matchedMember) {
    return undefined;
  }
  return select(matchedMember.fields);
}

export async function resolveAssigneePrimaryColor(
  familyId: string,
  assigneeId: string,
  idToken: string,
) {
  return resolveFromMember(familyId, assigneeId, idToken, (fields) =>
    resolveMemberPrimaryColor(readString(fields, "dashboardPrimaryColor") || undefined),
  );
}

export async function resolveAssigneeAvatarId(
  familyId: string,
  assigneeId: string,
  idToken: string,
) {
  return resolveFromMember(
    familyId,
    assigneeId,
    idToken,
    (fields) => readString(fields, "avatarId") || undefined,
  );
}

export async function resolveAssigneeAvatarPhotoUrl(
  familyId: string,
  assigneeId: string,
  idToken: string,
) {
  return resolveFromMember(
    familyId,
    assigneeId,
    idToken,
    (fields) => readString(fields, "avatarPhotoUrl") || undefined,
  );
}

export async function resolveAssigneeName(
  familyId: string,
  assigneeId: string,
  idToken: string,
  fallbackName = "Family member",
) {
  return (
    (await resolveFromMember(
      familyId,
      assigneeId,
      idToken,
      (fields) => readString(fields, "name") || undefined,
    )) ?? fallbackName
  );
}

// Resolves the Firebase uid for a chore assignee alias (doc id, uid, or email).
// Returns "" when the member cannot be resolved or is deleted.
export async function resolveAssigneeUid(
  familyId: string,
  assigneeId: string,
  idToken: string,
) {
  if (!assigneeId) {
    return "";
  }
  // Called repeatedly for the same assignee within one mutation (payouts, bonus
  // awards, achievement crediting all resolve it independently). Member identity
  // does not change mid-request.
  return memoizePerRequest(`assigneeUid:${familyId}:${assigneeId}`, () =>
    resolveAssigneeUidUncached(familyId, assigneeId, idToken),
  );
}

async function resolveAssigneeUidUncached(
  familyId: string,
  assigneeId: string,
  idToken: string,
) {
  const normalizedAssignee = normalizeEmail(assigneeId);
  let matchedEmail = "";
  try {
    const memberDoc = await getDocument(`families/${familyId}/members/${assigneeId}`, idToken);
    if (readBoolean(memberDoc.fields, "deleted")) {
      return "";
    }
    const memberUid = readString(memberDoc.fields, "uid");
    if (memberUid) {
      return memberUid;
    }
    matchedEmail = normalizeEmail(readString(memberDoc.fields, "email"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (!reason.includes("FIRESTORE_HTTP_404")) {
      throw error;
    }
  }

  const memberDocs = await listDocuments(`families/${familyId}/members`, idToken, 100);
  for (const memberDoc of memberDocs) {
    if (readBoolean(memberDoc.fields, "deleted")) {
      continue;
    }
    const memberId = documentIdFromName(memberDoc.name);
    const memberUid = readString(memberDoc.fields, "uid");
    const memberEmail = normalizeEmail(readString(memberDoc.fields, "email"));
    const aliasMatch =
      memberId === assigneeId ||
      (memberUid && memberUid === assigneeId) ||
      (normalizedAssignee !== "" && memberEmail === normalizedAssignee);
    if (aliasMatch) {
      if (memberUid) {
        return memberUid;
      }
      if (!matchedEmail && memberEmail) {
        matchedEmail = memberEmail;
      }
    }
  }

  if (matchedEmail) {
    for (const memberDoc of memberDocs) {
      if (readBoolean(memberDoc.fields, "deleted")) {
        continue;
      }
      const memberUid = readString(memberDoc.fields, "uid");
      const memberEmail = normalizeEmail(readString(memberDoc.fields, "email"));
      if (memberUid && memberEmail === matchedEmail) {
        return memberUid;
      }
    }
  }

  return "";
}

export async function countActiveChoresForAssignee(
  familyId: string,
  assigneeId: string,
  idToken: string,
  excludeChoreId?: string,
) {
  if (!assigneeId) {
    return 0;
  }
  const docs = await listAllDocuments(`families/${familyId}/chores`, idToken, {
    cap: MAX_CHORE_SCAN,
  });
  return docs.filter((doc) => {
    const id = documentIdFromName(doc.name);
    if (excludeChoreId && id === excludeChoreId) {
      return false;
    }
    if (readBoolean(doc.fields, "deleted")) {
      return false;
    }
    if (readString(doc.fields, "status") !== "Open") {
      return false;
    }
    return readString(doc.fields, "assigneeId") === assigneeId;
  }).length;
}

export async function listActiveFamilyMemberIds(familyId: string, idToken: string) {
  const memberDocs = await listDocuments(`families/${familyId}/members`, idToken, 200);
  return memberDocs
    .filter((doc) => !readBoolean(doc.fields, "deleted"))
    .filter((doc) => {
      const status = readString(doc.fields, "status");
      return status === "" || status === "active";
    })
    .map((doc) => documentIdFromName(doc.name))
    .filter(Boolean);
}

export async function userHasFamilyMembership(uid: string, familyId: string, idToken: string) {
  return memoizePerRequest(`familyMembership:${familyId}:${uid}`, () =>
    userHasFamilyMembershipUncached(uid, familyId, idToken),
  );
}

async function userHasFamilyMembershipUncached(uid: string, familyId: string, idToken: string) {
  try {
    const userDoc = await getDocument(`users/${uid}`, idToken);
    const familyIds = readStringArray(userDoc.fields, "familyIds");
    return familyIds.includes(familyId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("FIRESTORE_HTTP_404")) {
      return false;
    }
    throw error;
  }
}

// Resolves the effective assignee alias list for a chore: every active family
// member for family-scope chores, the explicit assignee list, or the single
// assignee id.
export async function resolveChoreAssigneeIds(
  familyId: string,
  fields: Record<string, FirestoreValue> | undefined,
  idToken: string,
) {
  const assigneeId = readString(fields, "assigneeId");
  const assigneeIdsRaw = readStringArray(fields, "assigneeIds");
  const assigneeScope = readString(fields, "assigneeScope");
  if (assigneeScope === "family") {
    return listActiveFamilyMemberIds(familyId, idToken);
  }
  if (assigneeIdsRaw.length > 0) {
    return assigneeIdsRaw;
  }
  return assigneeId ? [assigneeId] : [];
}
