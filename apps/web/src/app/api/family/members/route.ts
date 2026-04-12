import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import { createFamilyForUser } from "@/lib/family/bootstrap";
import {
  boolField,
  createOrReplaceDocument,
  findFirstFamilyIdByMemberUid,
  getDocument,
  listDocuments,
  patchDocument,
  readBoolean,
  readStringArray,
  stringArrayField,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";

type AddMemberBody = {
  name?: string;
  email?: string;
  role?: string;
};
const MAX_FAMILY_MEMBERS = 100;

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

function jsonFirestoreNotConfigured() {
  return NextResponse.json(
    {
      error: "firestore_not_configured",
      message:
        "Cloud Firestore default database is not configured for this project.",
    },
    { status: 503 },
  );
}

function isLikelyEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function getUserFamilyIds(uid: string, idToken: string) {
  try {
    const userDoc = await getDocument(`users/${uid}`, idToken);
    return readStringArray(userDoc.fields, "familyIds");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("FIRESTORE_HTTP_404")) {
      return [];
    }
    throw error;
  }
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
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  let body: AddMemberBody;
  try {
    body = (await request.json()) as AddMemberBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const name = (body.name ?? "").trim();
  const email = (body.email ?? "").trim().toLowerCase();
  const role = body.role === "admin" ? "admin" : "player";

  if (name.length < 2 || name.length > 80) {
    return NextResponse.json(
      { error: "name_must_be_between_2_and_80_chars" },
      { status: 400 },
    );
  }

  if (email && !isLikelyEmail(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  try {    const { data, session: refreshedSession, refreshed } =
      await runWithRefreshedFirebaseToken(session, async (idToken) => {
        let familyIds = await getUserFamilyIds(session.uid, idToken);
        let familyId = familyIds[0];
        if (!familyId) {
          const recoveredFamilyId = await findFirstFamilyIdByMemberUid(session.uid, idToken);
          if (recoveredFamilyId) {
            familyId = recoveredFamilyId;
            await relinkUserPrimaryFamily(session.uid, familyId, idToken);
          } else {
            familyId = await createFamilyForUser({
              uid: session.uid,
              userName: session.name,
              userEmail: session.email,
              idToken,
            });
          }
          familyIds = [familyId];
        }

        const memberId = email || randomUUID();
        const existingMembers = await listDocuments(`families/${familyId}/members`, idToken, 300);
        const activeMemberCount = existingMembers.filter(
          (doc) => !readBoolean(doc.fields, "deleted"),
        ).length;
        const targetExists = existingMembers.some((doc) => doc.name.endsWith(`/${memberId}`));
        if (!targetExists && activeMemberCount >= MAX_FAMILY_MEMBERS) {
          return { kind: "family_member_limit_reached" as const };
        }

        const now = new Date().toISOString();
        await createOrReplaceDocument(
          `families/${familyId}/members/${memberId}`,
          {
            name: stringField(name),
            email: stringField(email),
            role: stringField(role),
            status: stringField("invited"),
            deleted: boolField(false),
            createdBy: stringField(session.uid),
            createdAt: timestampField(now),
          },
          idToken,
        );
        if (email) {
          await createOrReplaceDocument(
            `inviteLookup/${email}`,
            {
              email: stringField(email),
              familyId: stringField(familyId),
              role: stringField(role),
              status: stringField("invited"),
              updatedAt: timestampField(now),
            },
            idToken,
          );
        }
        return {
          kind: "ok" as const,
          familyId,
          member: { id: memberId, name, email, role, status: "invited" },
        };
      });

    if (data.kind === "family_member_limit_reached") {
      return NextResponse.json(
        { error: "family_member_limit_reached", maxFamilyMembers: MAX_FAMILY_MEMBERS },
        { status: 409 },
      );
    }

    const response = NextResponse.json(
      { familyId: data.familyId, member: data.member },
      { status: 201 },
    );
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 160) : "unknown";
    console.error("[ADD_FAMILY_MEMBER_ERROR]", reason);
    if (
      reason.includes("FIRESTORE_HTTP_404") &&
      reason.toLowerCase().includes("database (default) does not exist")
    ) {
      return jsonFirestoreNotConfigured();
    }
    if (
      reason.includes("FIRESTORE_HTTP_401")
    ) {
      return jsonReauthRequired();
    }
    if (reason.includes("FIREBASE_REFRESH_FAILED")) {
      return jsonReauthRequired();
    }
    if (reason.includes("FIRESTORE_HTTP_403")) {
      return jsonFirestoreForbidden();
    }
    return NextResponse.json({ error: "add_member_failed" }, { status: 500 });
  }
}

