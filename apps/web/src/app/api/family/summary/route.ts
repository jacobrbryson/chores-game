import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  documentIdFromName,
  findFirstFamilyIdByMemberUid,
  getDocument,
  listDocuments,
  patchDocument,
  readBoolean,
  readInteger,
  readString,
  readStringArray,
  readTimestamp,
  stringArrayField,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";
import type { FamilySummaryResponse } from "@/lib/family/types";

export const dynamic = "force-dynamic";
const MAX_FAMILY_MEMBERS = 100;

function toUnixMillis(value: string | undefined) {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function emptySummary(viewerUid: string): FamilySummaryResponse {
  return {
    viewerUid,
    noFamily: true,
    family: null,
    members: [],
    choresToday: [],
  };
}

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

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  try {
    const { data, session: refreshedSession, refreshed } =
      await runWithRefreshedFirebaseToken(session, async (idToken) => {
        let userDoc;
        try {
          userDoc = await getDocument(`users/${session.uid}`, idToken);
        } catch (error) {
          const reason = error instanceof Error ? error.message : "";
          if (
            reason.includes("FIRESTORE_HTTP_404") &&
            reason.toLowerCase().includes("document") &&
            reason.toLowerCase().includes("not found")
          ) {
            return emptySummary(session.uid);
          }
          throw error;
        }

        const familyIds = readStringArray(userDoc.fields, "familyIds");
        let familyId = familyIds[0];

        if (!familyId) {
          const recoveredFamilyId = await findFirstFamilyIdByMemberUid(session.uid, idToken);
          if (!recoveredFamilyId) {
            return emptySummary(session.uid);
          }
          familyId = recoveredFamilyId;
          await relinkUserPrimaryFamily(session.uid, familyId, idToken);
        }

        const [familyDoc, memberDocs, choreDocs] = await Promise.all([
          getDocument(`families/${familyId}`, idToken),
          listDocuments(`families/${familyId}/members`, idToken, 100),
          listDocuments(`families/${familyId}/chores`, idToken, 100),
        ]);

        const today = new Date().toISOString().slice(0, 10);

        return {
          viewerUid: session.uid,
          noFamily: false,
          family: {
            id: familyId,
            name: readString(familyDoc.fields, "name") || "My Family",
          },
          members: memberDocs
            .map((doc) => ({
              id: documentIdFromName(doc.name),
              uid: readString(doc.fields, "uid") || undefined,
              name: readString(doc.fields, "name") || "Unnamed member",
              email: readString(doc.fields, "email"),
              role: readString(doc.fields, "role") === "admin" ? "admin" : "player",
              status:
                readString(doc.fields, "status") === "active" ? "active" : "invited",
              lastSignInAt: readTimestamp(doc.fields, "lastSignInAt") || undefined,
              deleted: readBoolean(doc.fields, "deleted"),
            }))
            .filter((member) => !member.deleted)
            .sort((a, b) => {
              const aIsViewer = a.id === session.uid || a.uid === session.uid;
              const bIsViewer = b.id === session.uid || b.uid === session.uid;
              if (aIsViewer && !bIsViewer) {
                return -1;
              }
              if (!aIsViewer && bIsViewer) {
                return 1;
              }
              return toUnixMillis(b.lastSignInAt) - toUnixMillis(a.lastSignInAt);
            })
            .map((member) => ({
              id: member.id,
              uid: member.uid,
              name: member.name,
              email: member.email,
              role: member.role,
              status: member.status,
              lastSignInAt: member.lastSignInAt,
            }))
            .slice(0, MAX_FAMILY_MEMBERS),
          choresToday: choreDocs
            .map((doc) => ({
              id: documentIdFromName(doc.name),
              title: readString(doc.fields, "title") || "Untitled chore",
              status: readString(doc.fields, "status"),
              assigneeName: readString(doc.fields, "assigneeName") || "Unassigned",
              dueDate: readString(doc.fields, "dueDate"),
              deleted: readBoolean(doc.fields, "deleted"),
              coinValue: readInteger(doc.fields, "coinValue") || 10,
            }))
            .filter((chore) => chore.dueDate === today && !chore.deleted)
            .map((chore) => ({
              id: chore.id,
              title: chore.title,
              assigneeName: chore.assigneeName,
              dueDate: chore.dueDate,
              coinValue: chore.coinValue,
              status:
                chore.status === "Open" ||
                chore.status === "Submitted" ||
                chore.status === "Approved" ||
                chore.status === "Rejected"
                  ? chore.status
                  : "Unknown",
            })),
        } satisfies FamilySummaryResponse;
      });

    const response = NextResponse.json(data);
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 160) : "unknown";
    console.error("[FAMILY_SUMMARY_ERROR]", reason);
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
    return NextResponse.json({ error: "summary_unavailable" }, { status: 500 });
  }
}
