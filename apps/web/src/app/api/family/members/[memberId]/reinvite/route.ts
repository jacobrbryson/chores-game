import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  boolField,
  createOrReplaceDocument,
  getDocument,
  patchDocument,
  readBoolean,
  readString,
  readStringArray,
  readTimestamp,
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

async function getPrimaryFamilyId(uid: string, idToken: string) {
  const userDoc = await getDocument(`users/${uid}`, idToken);
  return readStringArray(userDoc.fields, "familyIds")[0] ?? "";
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ memberId: string }> },
) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  const { memberId } = await context.params;
  if (!memberId) {
    return NextResponse.json({ error: "member_id_required" }, { status: 400 });
  }

  try {
    const { data, session: refreshedSession, refreshed } =
      await runWithRefreshedFirebaseToken(session, async (idToken) => {
        const familyId = await getPrimaryFamilyId(session.uid, idToken);
        if (!familyId) {
          return { kind: "family_not_found" as const };
        }

        const requesterMemberDoc = await getDocument(
          `families/${familyId}/members/${session.uid}`,
          idToken,
        );
        const requesterRole = readString(requesterMemberDoc.fields, "role");
        if (requesterRole !== "admin") {
          return { kind: "not_allowed" as const };
        }

        const memberDoc = await getDocument(`families/${familyId}/members/${memberId}`, idToken);
        const memberUid = readString(memberDoc.fields, "uid");
        const memberEmail = readString(memberDoc.fields, "email").trim().toLowerCase();
        const memberName = readString(memberDoc.fields, "name");
        const memberRole = readString(memberDoc.fields, "role") === "admin" ? "admin" : "player";
        const createdBy = readString(memberDoc.fields, "createdBy");
        const createdAt = readTimestamp(memberDoc.fields, "createdAt");
        const deleted = readBoolean(memberDoc.fields, "deleted");

        if (memberId === session.uid || memberUid === session.uid) {
          return { kind: "cannot_reinvite_self" as const };
        }
        if (!memberEmail) {
          return { kind: "member_email_required" as const };
        }
        if (deleted) {
          return { kind: "member_not_found" as const };
        }

        const now = new Date().toISOString();
        const emailKeyedMemberId = memberEmail;

        // Migrate older random-id invite docs to email-keyed IDs so invitees can resolve membership.
        if (!memberUid && emailKeyedMemberId !== memberId) {
          await createOrReplaceDocument(
            `families/${familyId}/members/${emailKeyedMemberId}`,
            {
              name: stringField(memberName || "Unnamed member"),
              email: stringField(memberEmail),
              role: stringField(memberRole),
              status: stringField("invited"),
              deleted: boolField(false),
              createdBy: stringField(createdBy || session.uid),
              createdAt: timestampField(createdAt || now),
              reinvitedAt: timestampField(now),
            },
            idToken,
          );
          await patchDocument(
            `families/${familyId}/members/${memberId}`,
            {
              deleted: boolField(true),
              deletedAt: timestampField(now),
            },
            idToken,
            ["deleted", "deletedAt"],
          );
          await createOrReplaceDocument(
            `inviteLookup/${memberEmail}`,
            {
              email: stringField(memberEmail),
              familyId: stringField(familyId),
              role: stringField(memberRole),
              status: stringField("invited"),
              updatedAt: timestampField(now),
            },
            idToken,
          );
          return { kind: "ok" as const, reinvitedAt: now };
        }

        await patchDocument(
          `families/${familyId}/members/${memberId}`,
          {
            status: stringField("invited"),
            reinvitedAt: timestampField(now),
          },
          idToken,
          ["status", "reinvitedAt"],
        );
        await createOrReplaceDocument(
          `inviteLookup/${memberEmail}`,
          {
            email: stringField(memberEmail),
            familyId: stringField(familyId),
            role: stringField(memberRole),
            status: stringField("invited"),
            updatedAt: timestampField(now),
          },
          idToken,
        );

        return { kind: "ok" as const, reinvitedAt: now };
      });

    if (data.kind === "family_not_found") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    if (data.kind === "cannot_reinvite_self") {
      return NextResponse.json({ error: "cannot_reinvite_self" }, { status: 400 });
    }
    if (data.kind === "member_email_required") {
      return NextResponse.json({ error: "member_email_required" }, { status: 400 });
    }
    if (data.kind === "member_not_found") {
      return NextResponse.json({ error: "member_not_found" }, { status: 404 });
    }
    if (data.kind === "not_allowed") {
      return NextResponse.json({ error: "not_allowed" }, { status: 403 });
    }

    const response = NextResponse.json({ success: true, reinvitedAt: data.reinvitedAt });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[REINVITE_FAMILY_MEMBER_ERROR]", reason);
    if (reason.includes("FIRESTORE_HTTP_401")) {
      return jsonReauthRequired();
    }
    if (reason.includes("FIREBASE_REFRESH_FAILED")) {
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
      return NextResponse.json({ error: "member_not_found" }, { status: 404 });
    }
    return NextResponse.json({ error: "reinvite_member_failed" }, { status: 500 });
  }
}
