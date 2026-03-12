import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  boolField,
  createOrReplaceDocument,
  findFirstFamilyIdByMemberEmail,
  getDocument,
  patchDocument,
  readBoolean,
  readString,
  readStringArray,
  readTimestamp,
  stringArrayField,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";

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

function isDocumentNotFoundError(reason: string) {
  return (
    reason.includes("FIRESTORE_HTTP_404") &&
    reason.toLowerCase().includes("document") &&
    reason.toLowerCase().includes("not found")
  );
}

function normalizeMemberStatus(value: string) {
  if (value === "invited" || value === "claimed" || value === "active") {
    return value;
  }
  return "";
}

async function relinkUserPrimaryFamily(uid: string, familyId: string, idToken: string) {
  const now = new Date().toISOString();
  await patchDocument(
    `users/${uid}`,
    {
      uid: stringField(uid),
      familyIds: stringArrayField([familyId]),
      lastFamilyUpdateAt: timestampField(now),
    },
    idToken,
    ["familyIds", "lastFamilyUpdateAt", "uid"],
  );
}

export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  const normalizedEmail = session.email.trim().toLowerCase();
  if (!normalizedEmail) {
    return NextResponse.json({ error: "session_email_missing" }, { status: 400 });
  }

  try {    const { data, session: refreshedSession, refreshed } =
      await runWithRefreshedFirebaseToken(session, async (idToken) => {
        let familyId = "";
        let familyIdSource = "";
        try {
          const userDoc = await getDocument(`users/${session.uid}`, idToken);
          familyId = readStringArray(userDoc.fields, "familyIds")[0] ?? "";
          if (familyId) {
            familyIdSource = "users.familyIds";
          }
        } catch (error) {
          const reason = error instanceof Error ? error.message : "";          if (!reason.includes("FIRESTORE_HTTP_404")) {
            throw error;
          }
        }

        if (!familyId) {
          try {
            const inviteLookupDoc = await getDocument(`inviteLookup/${normalizedEmail}`, idToken);
            const status = readString(inviteLookupDoc.fields, "status");
            const candidateFamilyId = readString(inviteLookupDoc.fields, "familyId");
            if ((status === "invited" || status === "claimed") && candidateFamilyId) {
              familyId = candidateFamilyId;
              familyIdSource = "inviteLookup";
            }          } catch (error) {
            const reason = error instanceof Error ? error.message : "";            if (!reason.includes("FIRESTORE_HTTP_404")) {
              throw error;
            }
          }
        }

        if (!familyId) {
          familyId = await findFirstFamilyIdByMemberEmail(normalizedEmail, idToken);
          if (familyId) {
            familyIdSource = "member_email_query";
          }
        }        if (!familyId) {
          return { kind: "invite_not_found" as const };
        }

        const uidMemberPath = `families/${familyId}/members/${session.uid}`;
        const emailMemberPath = `families/${familyId}/members/${normalizedEmail}`;
        let inviteDoc: Awaited<ReturnType<typeof getDocument>> | null = null;
        let inviteDocSource: "email_member_doc" | "uid_member_doc" | "" = "";
        try {
          inviteDoc = await getDocument(emailMemberPath, idToken);
          inviteDocSource = "email_member_doc";
        } catch (error) {
          const reason = error instanceof Error ? error.message : "";          if (isDocumentNotFoundError(reason)) {
            inviteDoc = null;
          } else {
            throw error;
          }
        }

        const now = new Date().toISOString();
        const getInviteRole = (doc: Awaited<ReturnType<typeof getDocument>>) =>
          readString(doc.fields, "role") === "admin" ? "admin" : "player";
        const getInviteName = (doc: Awaited<ReturnType<typeof getDocument>>) =>
          readString(doc.fields, "name") || session.name || "Family member";
        const getInviteCreatedAt = (doc: Awaited<ReturnType<typeof getDocument>>) =>
          readTimestamp(doc.fields, "createdAt") || now;

        let existingUidMemberDoc: Awaited<ReturnType<typeof getDocument>> | null = null;
        try {
          existingUidMemberDoc = await getDocument(uidMemberPath, idToken);
        } catch (error) {
          const reason = error instanceof Error ? error.message : "";
          if (!isDocumentNotFoundError(reason)) {
            throw error;
          }
        }

        if (!inviteDoc && existingUidMemberDoc && !readBoolean(existingUidMemberDoc.fields, "deleted")) {
          const existingEmail = readString(existingUidMemberDoc.fields, "email").trim().toLowerCase();
          const existingStatus = normalizeMemberStatus(readString(existingUidMemberDoc.fields, "status"));
          if ((!existingEmail || existingEmail === normalizedEmail) && existingStatus) {
            inviteDoc = existingUidMemberDoc;
            inviteDocSource = "uid_member_doc";
          }
        }

        if (!inviteDoc || readBoolean(inviteDoc.fields, "deleted")) {
          return { kind: "invite_not_found" as const };
        }

        const inviteStatus = normalizeMemberStatus(readString(inviteDoc.fields, "status"));
        if (!inviteStatus) {
          return { kind: "invite_not_found" as const };
        }
        const inviteRole = getInviteRole(inviteDoc);
        const inviteName = getInviteName(inviteDoc);
        const inviteCreatedAt = getInviteCreatedAt(inviteDoc);
        if (existingUidMemberDoc && !readBoolean(existingUidMemberDoc.fields, "deleted")) {
          const existingStatus = normalizeMemberStatus(readString(existingUidMemberDoc.fields, "status"));
          const existingEmail = readString(existingUidMemberDoc.fields, "email").trim().toLowerCase();
          if (
            existingStatus === "active" &&
            (!existingEmail || existingEmail === normalizedEmail)
          ) {
            try {
              await patchDocument(
                uidMemberPath,
                {
                  lastSignInAt: timestampField(now),
                },
                idToken,
                ["lastSignInAt"],
              );
            } catch (error) {
              const reason = error instanceof Error ? error.message : "";
              if (!reason.includes("FIRESTORE_HTTP_404") && !reason.includes("FIRESTORE_HTTP_403")) {
                throw error;
              }
            }
            await relinkUserPrimaryFamily(session.uid, familyId, idToken);
            return { kind: "ok" as const, familyId };
          }
        }

        const uidMemberFields = {
          name: stringField(inviteName),
          email: stringField(normalizedEmail),
          role: stringField(inviteRole),
          status: stringField("active"),
          deleted: boolField(false),
          uid: stringField(session.uid),
          createdAt: timestampField(inviteCreatedAt),
          acceptedInviteAt: timestampField(now),
          lastSignInAt: timestampField(now),
        };

        try {
          if (existingUidMemberDoc && !readBoolean(existingUidMemberDoc.fields, "deleted")) {
            await patchDocument(
              uidMemberPath,
              uidMemberFields,
              idToken,
              [
                "name",
                "email",
                "role",
                "status",
                "deleted",
                "uid",
                "createdAt",
                "acceptedInviteAt",
                "lastSignInAt",
              ],
            );
          } else {
            await createOrReplaceDocument(uidMemberPath, uidMemberFields, idToken);
          }        } catch (error) {
          const reason = error instanceof Error ? error.message : "unknown";          throw error;
        }

        try {
          await relinkUserPrimaryFamily(session.uid, familyId, idToken);
        } catch (error) {
          const reason = error instanceof Error ? error.message : "unknown";          throw error;
        }        return { kind: "ok" as const, familyId };
      });

    if (data.kind === "invite_not_found") {
      return NextResponse.json({ error: "invite_not_found" }, { status: 404 });
    }

    const response = NextResponse.json({ success: true, familyId: data.familyId });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[ACCEPT_FAMILY_INVITE_ERROR]", reason);
    if (reason.includes("FIRESTORE_HTTP_401")) {
      return jsonReauthRequired();
    }
    if (reason.includes("FIREBASE_REFRESH_FAILED")) {
      return jsonReauthRequired();
    }
    if (reason.includes("FIRESTORE_HTTP_403")) {
      return jsonFirestoreForbidden();
    }
    return NextResponse.json({ error: "accept_invite_failed" }, { status: 500 });
  }
}

