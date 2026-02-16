import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  documentIdFromName,
  findFirstFamilyIdByMemberEmail,
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
import type { FamilySnapshotMember, FamilySummaryResponse } from "@/lib/family/types";

export const dynamic = "force-dynamic";
const MAX_FAMILY_MEMBERS = 100;

function maskEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  const atIndex = normalized.indexOf("@");
  if (atIndex <= 1) {
    return normalized || "(empty)";
  }
  return `${normalized.slice(0, 2)}***${normalized.slice(atIndex)}`;
}

function logInviteDebug(event: string, details: Record<string, unknown>) {
  console.info("[INVITE_DEBUG]", event, JSON.stringify(details));
}

function toUnixMillis(value: string | undefined) {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function toMemberRole(value: string | undefined): FamilySnapshotMember["role"] {
  return value === "admin" ? "admin" : "player";
}

function toMemberStatus(value: string | undefined): FamilySnapshotMember["status"] {
  return value === "active" ? "active" : "invited";
}

function emptySummary(viewerUid: string): FamilySummaryResponse {
  return {
    viewerUid,
    noFamily: true,
    family: null,
    members: [],
    choresToday: [],
    pendingInvite: null,
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
    logInviteDebug("summary_start", {
      uid: session.uid,
      email: maskEmail(session.email),
    });
    const { data, session: refreshedSession, refreshed } =
      await runWithRefreshedFirebaseToken(session, async (idToken) => {
        let userDoc: Awaited<ReturnType<typeof getDocument>> | null = null;
        try {
          userDoc = await getDocument(`users/${session.uid}`, idToken);
        } catch (error) {
          const reason = error instanceof Error ? error.message : "";
          if (
            reason.includes("FIRESTORE_HTTP_404") &&
            reason.toLowerCase().includes("document") &&
            reason.toLowerCase().includes("not found")
          ) {
            userDoc = null;
          } else {
            throw error;
          }
        }

        const familyIds = readStringArray(userDoc?.fields, "familyIds");
        let familyId = familyIds[0];
        logInviteDebug("summary_user_doc", {
          uid: session.uid,
          userDocFound: Boolean(userDoc),
          familyIdsCount: familyIds.length,
          familyId: familyId || null,
        });

        if (!familyId) {
          let inviteLookupFamilyId = "";
          if (session.email) {
            try {
              const inviteLookupDoc = await getDocument(
                `inviteLookup/${session.email.trim().toLowerCase()}`,
                idToken,
              );
              const status = readString(inviteLookupDoc.fields, "status");
              const candidateFamilyId = readString(inviteLookupDoc.fields, "familyId");
              if ((status === "invited" || status === "claimed") && candidateFamilyId) {
                inviteLookupFamilyId = candidateFamilyId;
              }
            } catch (error) {
              const reason = error instanceof Error ? error.message : "";
              if (!reason.includes("FIRESTORE_HTTP_404")) {
                logInviteDebug("summary_invite_lookup_error", {
                  uid: session.uid,
                  email: maskEmail(session.email),
                  reason: reason.slice(0, 180),
                });
              }
            }
          }
          const uidRecoveredFamilyId = await findFirstFamilyIdByMemberUid(session.uid, idToken);
          const emailRecoveredFamilyId = uidRecoveredFamilyId || inviteLookupFamilyId
            ? ""
            : await findFirstFamilyIdByMemberEmail(session.email, idToken);
          const recoveredFamilyId =
            uidRecoveredFamilyId || inviteLookupFamilyId || emailRecoveredFamilyId;
          logInviteDebug("summary_family_recovery", {
            uid: session.uid,
            email: maskEmail(session.email),
            uidRecoveredFamilyId: uidRecoveredFamilyId || null,
            inviteLookupFamilyId: inviteLookupFamilyId || null,
            emailRecoveredFamilyId: emailRecoveredFamilyId || null,
            recoveredFamilyId: recoveredFamilyId || null,
          });
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
        const rawMemberCount = memberDocs.length;
        const familyName = readString(familyDoc.fields, "name") || "My Family";

        const rawMembers = memberDocs
          .map((doc) => ({
            id: documentIdFromName(doc.name),
            uid: readString(doc.fields, "uid") || undefined,
            name: readString(doc.fields, "name") || "Unnamed member",
            email: readString(doc.fields, "email"),
            role: toMemberRole(readString(doc.fields, "role")),
            status: toMemberStatus(readString(doc.fields, "status")),
            lastSignInAt: readTimestamp(doc.fields, "lastSignInAt") || undefined,
            createdBy: readString(doc.fields, "createdBy"),
            createdAt: readTimestamp(doc.fields, "createdAt") || undefined,
            deleted: readBoolean(doc.fields, "deleted"),
          }))
          .filter((member) => !member.deleted);

        const normalizedSessionEmail = session.email.trim().toLowerCase();
        const viewerMember =
          rawMembers.find((member) => member.uid === session.uid) ||
          rawMembers.find(
            (member) => !member.uid && member.email.trim().toLowerCase() === normalizedSessionEmail,
          );
        if (viewerMember?.status === "invited") {
          const inviter =
            rawMembers.find(
              (member) => member.uid === viewerMember.createdBy || member.id === viewerMember.createdBy,
            ) ?? null;
          const pendingSummary: FamilySummaryResponse = {
            viewerUid: session.uid,
            noFamily: false,
            family: {
              id: familyId,
              name: familyName,
            },
            members: inviter
              ? [
                  {
                    id: inviter.id,
                    uid: inviter.uid,
                    name: inviter.name,
                    email: inviter.email,
                    role: inviter.role,
                    status: inviter.status,
                    lastSignInAt: inviter.lastSignInAt,
                  },
                ]
              : [],
            choresToday: [],
            pendingInvite: {
              familyId,
              familyName,
              invitedEmail: viewerMember.email || normalizedSessionEmail,
              invitedAt: viewerMember.createdAt,
              inviter: inviter
                ? {
                    id: inviter.id,
                    name: inviter.name,
                    email: inviter.email,
                  }
                : null,
            },
          };
          return pendingSummary;
        }

        const mappedMembers = rawMembers
          .filter((member, _index, members) => {
            if (member.uid) {
              return true;
            }
            const normalizedEmail = member.email.trim().toLowerCase();
            if (!normalizedEmail) {
              return true;
            }
            return !members.some(
              (candidate) =>
                Boolean(candidate.uid) &&
                candidate.email.trim().toLowerCase() === normalizedEmail,
            );
          })
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
          .slice(0, MAX_FAMILY_MEMBERS);

        logInviteDebug("summary_members_loaded", {
          uid: session.uid,
          familyId,
          rawMemberCount,
          returnedMemberCount: mappedMembers.length,
        });

        return {
          viewerUid: session.uid,
          noFamily: false,
          family: {
            id: familyId,
            name: familyName,
          },
          members: mappedMembers,
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
          pendingInvite: null,
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
