import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  getDocument,
  patchDocument,
  readString,
  readStringArray,
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

        const memberDoc = await getDocument(`families/${familyId}/members/${memberId}`, idToken);
        const memberUid = readString(memberDoc.fields, "uid");
        const memberEmail = readString(memberDoc.fields, "email");

        if (memberId === session.uid || memberUid === session.uid) {
          return { kind: "cannot_reinvite_self" as const };
        }
        if (!memberEmail) {
          return { kind: "member_email_required" as const };
        }

        const now = new Date().toISOString();
        await patchDocument(
          `families/${familyId}/members/${memberId}`,
          {
            status: stringField("invited"),
            reinvitedAt: timestampField(now),
          },
          idToken,
          ["status", "reinvitedAt"],
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
