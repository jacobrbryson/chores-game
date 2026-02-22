import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  documentIdFromName,
  boolField,
  getDocument,
  listDocuments,
  patchDocument,
  readBoolean,
  readString,
  readStringArray,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";

type UpdateChoreBody = {
  action?: unknown;
  description?: unknown;
  assigneeId?: unknown;
  dueDate?: unknown;
  details?: unknown;
};

function jsonUnauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

function jsonReauthRequired() {
  return NextResponse.json(
    {
      error: "reauth_required",
      message: "Please sign out and sign in again to refresh your session.",
    },
    { status: 401 },
  );
}

function jsonFirestoreForbidden() {
  return NextResponse.json(
    {
      error: "firestore_forbidden",
      message:
        "Authenticated user does not have access to Firestore documents under current rules.",
    },
    { status: 403 },
  );
}

async function getPrimaryFamilyId(uid: string, idToken: string) {
  const userDoc = await getDocument(`users/${uid}`, idToken);
  return readStringArray(userDoc.fields, "familyIds")[0] ?? "";
}

function normalizeDescription(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function asValidDate(value: unknown) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  return "";
}

async function getFamilyMemberName(
  familyId: string,
  memberId: string,
  idToken: string,
) {
  try {
    const memberDoc = await getDocument(`families/${familyId}/members/${memberId}`, idToken);
    return readString(memberDoc.fields, "name") || "Unassigned";
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("FIRESTORE_HTTP_404")) {
      return "Unassigned";
    }
    throw error;
  }
}

function mapCommonFirestoreErrors(reason: string, fallbackError: string) {
  if (reason.includes("FIRESTORE_HTTP_401") || reason.includes("FIREBASE_REFRESH_FAILED")) {
    return jsonReauthRequired();
  }
  if (reason.includes("FIRESTORE_HTTP_403")) {
    return jsonFirestoreForbidden();
  }
  if (
    reason.includes("FIRESTORE_HTTP_404") &&
    reason.toLowerCase().includes("document") &&
    reason.toLowerCase().includes("not found")
  ) {
    return NextResponse.json({ error: "chore_not_found" }, { status: 404 });
  }
  return NextResponse.json({ error: fallbackError }, { status: 500 });
}

type RequesterContext = {
  role: "admin" | "player";
  assigneeAliases: Set<string>;
};

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function isRequesterAssignee(choreAssigneeId: string, uid: string, email: string) {
  if (!choreAssigneeId) {
    return false;
  }
  if (choreAssigneeId === uid) {
    return true;
  }
  const normalizedAssignee = normalizeEmail(choreAssigneeId);
  const normalizedEmail = normalizeEmail(email);
  return Boolean(normalizedEmail) && normalizedAssignee === normalizedEmail;
}

function toRole(value: string) {
  return value === "admin" ? "admin" : "player";
}

async function getRequesterContext(
  familyId: string,
  uid: string,
  email: string,
  idToken: string,
): Promise<RequesterContext> {
  const aliases = new Set<string>([uid]);
  let role: "admin" | "player" = "player";
  let roleResolved = false;
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
      }
    }
  }

  return { role, assigneeAliases: aliases };
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ choreId: string }> },
) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  const { choreId } = await context.params;
  if (!choreId) {
    return NextResponse.json({ error: "chore_id_required" }, { status: 400 });
  }

  let body: UpdateChoreBody;
  try {
    body = (await request.json()) as UpdateChoreBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "edit";
  if (action !== "edit" && action !== "complete" && action !== "undo_complete") {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }
  let debugStep = "validate_body";

  const normalizedDescription =
    typeof body.description === "string" ? normalizeDescription(body.description) : "";
  const assigneeId =
    typeof body.assigneeId === "string" && body.assigneeId.trim().length > 0
      ? body.assigneeId.trim()
      : "";
  const dueDate = asValidDate(body.dueDate);
  const details =
    typeof body.details === "string" && body.details.trim().length > 0
      ? body.details.trim().slice(0, 2000)
      : "";

  if (action === "edit") {
    if (!normalizedDescription) {
      return NextResponse.json({ error: "description_required" }, { status: 400 });
    }
    if (normalizedDescription.length > 160) {
      return NextResponse.json({ error: "description_too_long" }, { status: 400 });
    }
    if (!dueDate) {
      return NextResponse.json({ error: "due_date_required" }, { status: 400 });
    }
  }

  try {
    const { data, session: refreshedSession, refreshed } =
      await runWithRefreshedFirebaseToken(session, async (idToken) => {
        debugStep = "resolve_family";
        const familyId = await getPrimaryFamilyId(session.uid, idToken);
        if (!familyId) {
          return { kind: "family_not_found" as const };
        }

        const now = new Date().toISOString();
        if (action === "complete") {
          debugStep = "complete_load_chore";
          const existingChoreDoc = await getDocument(`families/${familyId}/chores/${choreId}`, idToken);
          const choreAssigneeId = readString(existingChoreDoc.fields, "assigneeId");
          const requesterOwnsChore = isRequesterAssignee(
            choreAssigneeId,
            session.uid,
            session.email,
          );
          console.info(
            "[CHORE_PATCH_DEBUG]",
            JSON.stringify({
              step: "complete_ownership_check",
              uid: session.uid,
              choreId,
              action,
              assigneeId: choreAssigneeId || null,
              requesterOwnsChore,
            }),
          );
          if (!requesterOwnsChore) {
            debugStep = "complete_role_lookup";
            const requester = await getRequesterContext(
              familyId,
              session.uid,
              session.email,
              idToken,
            );
            console.info(
              "[CHORE_PATCH_DEBUG]",
              JSON.stringify({
                step: "complete_role_check",
                uid: session.uid,
                choreId,
                action,
                role: requester.role,
              }),
            );
            if (requester.role !== "admin") {
              return { kind: "forbidden_action" as const };
            }
          }

          debugStep = "complete_patch";
          await patchDocument(
            `families/${familyId}/chores/${choreId}`,
            {
              status: stringField("Submitted"),
              submittedAt: timestampField(now),
              updatedAt: timestampField(now),
            },
            idToken,
            ["status", "submittedAt", "updatedAt"],
          );
        } else if (action === "undo_complete") {
          debugStep = "undo_role_lookup";
          const requester = await getRequesterContext(
            familyId,
            session.uid,
            session.email,
            idToken,
          );
          if (requester.role !== "admin") {
            return { kind: "forbidden_action" as const };
          }

          debugStep = "undo_load_chore";
          const existingChoreDoc = await getDocument(`families/${familyId}/chores/${choreId}`, idToken);
          const currentStatus = readString(existingChoreDoc.fields, "status") || "Open";
          if (currentStatus !== "Submitted" && currentStatus !== "Approved") {
            return { kind: "invalid_transition" as const };
          }

          debugStep = "undo_patch";
          await patchDocument(
            `families/${familyId}/chores/${choreId}`,
            {
              status: stringField("Open"),
              updatedAt: timestampField(now),
            },
            idToken,
            ["status", "updatedAt"],
          );
        } else {
          debugStep = "edit_role_lookup";
          const requester = await getRequesterContext(
            familyId,
            session.uid,
            session.email,
            idToken,
          );
          if (requester.role !== "admin") {
            return { kind: "forbidden_action" as const };
          }

          debugStep = "edit_patch";
          const resolvedAssigneeName = assigneeId
            ? await getFamilyMemberName(familyId, assigneeId, idToken)
            : "Unassigned";
          await patchDocument(
            `families/${familyId}/chores/${choreId}`,
            {
              title: stringField(normalizedDescription),
              assigneeId: stringField(assigneeId),
              assigneeName: stringField(resolvedAssigneeName),
              dueDate: stringField(dueDate),
              details: stringField(details),
              updatedAt: timestampField(now),
            },
            idToken,
            ["title", "assigneeId", "assigneeName", "dueDate", "details", "updatedAt"],
          );
        }

        return { kind: "ok" as const };
      });

    if (data.kind === "family_not_found") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    if (data.kind === "forbidden_action") {
      return NextResponse.json({ error: "forbidden_action" }, { status: 403 });
    }
    if (data.kind === "invalid_transition") {
      return NextResponse.json({ error: "invalid_status_transition" }, { status: 400 });
    }

    const response = NextResponse.json({ success: true });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error(
      "[CHORE_PATCH_ERROR]",
      JSON.stringify({
        reason,
        step: debugStep,
        action,
        uid: session.uid,
        email: session.email,
        choreId,
      }),
    );
    return mapCommonFirestoreErrors(reason, "update_chore_failed");
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ choreId: string }> },
) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  const { choreId } = await context.params;
  if (!choreId) {
    return NextResponse.json({ error: "chore_id_required" }, { status: 400 });
  }

  try {
    const { data, session: refreshedSession, refreshed } =
      await runWithRefreshedFirebaseToken(session, async (idToken) => {
        const familyId = await getPrimaryFamilyId(session.uid, idToken);
        if (!familyId) {
          return { kind: "family_not_found" as const };
        }
        const requester = await getRequesterContext(
          familyId,
          session.uid,
          session.email,
          idToken,
        );
        if (requester.role !== "admin") {
          return { kind: "forbidden_action" as const };
        }

        const now = new Date().toISOString();
        await patchDocument(
          `families/${familyId}/chores/${choreId}`,
          {
            deleted: boolField(true),
            deletedAt: timestampField(now),
            status: stringField("Deleted"),
          },
          idToken,
          ["deleted", "deletedAt", "status"],
        );

        return { kind: "ok" as const };
      });

    if (data.kind === "family_not_found") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    if (data.kind === "forbidden_action") {
      return NextResponse.json({ error: "forbidden_action" }, { status: 403 });
    }

    const response = NextResponse.json({ success: true });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[CHORE_SOFT_DELETE_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "delete_chore_failed");
  }
}
