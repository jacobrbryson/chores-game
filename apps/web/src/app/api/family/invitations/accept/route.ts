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

  try {
    const { data, session: refreshedSession, refreshed } =
      await runWithRefreshedFirebaseToken(session, async (idToken) => {
        let familyId = "";
        try {
          const userDoc = await getDocument(`users/${session.uid}`, idToken);
          familyId = readStringArray(userDoc.fields, "familyIds")[0] ?? "";
        } catch (error) {
          const reason = error instanceof Error ? error.message : "";
          if (!reason.includes("FIRESTORE_HTTP_404")) {
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
            }
          } catch (error) {
            const reason = error instanceof Error ? error.message : "";
            if (!reason.includes("FIRESTORE_HTTP_404")) {
              throw error;
            }
          }
        }

        if (!familyId) {
          familyId = await findFirstFamilyIdByMemberEmail(normalizedEmail, idToken);
        }
        if (!familyId) {
          return { kind: "invite_not_found" as const };
        }

        const inviteDoc = await getDocument(`families/${familyId}/members/${normalizedEmail}`, idToken);
        if (readBoolean(inviteDoc.fields, "deleted")) {
          return { kind: "invite_not_found" as const };
        }

        const now = new Date().toISOString();
        const inviteRole = readString(inviteDoc.fields, "role") === "admin" ? "admin" : "player";
        const inviteName =
          readString(inviteDoc.fields, "name") || session.name || "Family member";
        const inviteCreatedAt = readTimestamp(inviteDoc.fields, "createdAt") || now;

        await createOrReplaceDocument(
          `families/${familyId}/members/${session.uid}`,
          {
            name: stringField(inviteName),
            email: stringField(normalizedEmail),
            role: stringField(inviteRole),
            status: stringField("active"),
            deleted: boolField(false),
            uid: stringField(session.uid),
            createdAt: timestampField(inviteCreatedAt),
            acceptedInviteAt: timestampField(now),
          },
          idToken,
        );

        await relinkUserPrimaryFamily(session.uid, familyId, idToken);
        return { kind: "ok" as const, familyId };
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
