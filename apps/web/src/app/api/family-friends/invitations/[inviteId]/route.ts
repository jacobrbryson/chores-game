import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { writeAuditLogBestEffort } from "@/lib/audit/log";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import { writeCrossFamilyAuditBestEffort } from "@/lib/family-friends/audit";
import {
  createFamilyFriendToken,
  familyFriendInviteExpiresAt,
  hashFamilyFriendToken,
  isFamilyFriendInviteExpired,
  MAX_FAMILY_FRIENDS,
  normalizeFriendEmail,
} from "@/lib/family-friends/model";
import { familyFriendStatusCopy, notifyFamilyFriendInvite } from "@/lib/family-friends/notify";
import {
  findTargetAdminFamily,
  getFamilyFriendInvite,
  listFamilyFriends,
} from "@/lib/family-friends/repository";
import { getViewerFamilyContext } from "@/lib/family/member-access";
import {
  adminCommitWrites,
  adminCreateOrReplaceDocument,
  adminGetDocument,
  adminPatchDocument,
} from "@/lib/firestore/admin";
import { readString, stringArrayField, stringField, timestampField } from "@/lib/firestore/rest";

type ActionBody = { action?: unknown };

function responseForError(kind: string) {
  const statuses: Record<string, number> = {
    family_not_found: 404,
    invite_not_found: 404,
    forbidden: 403,
    wrong_recipient: 403,
    invite_expired: 410,
    invite_not_pending: 409,
    same_family: 409,
    already_friends: 409,
    friend_limit: 409,
  };
  return NextResponse.json({ error: kind }, { status: statuses[kind] || 400 });
}

async function writeAcceptedNotification(input: {
  familyId: string;
  otherFamilyName: string;
  actorUid: string;
  actorEmail: string;
  actorName: string;
  locale?: string;
}) {
  const now = new Date().toISOString();
  const copy = familyFriendStatusCopy(input.locale, "accepted", input.otherFamilyName);
  await adminCreateOrReplaceDocument(`families/${input.familyId}/notifications/${randomUUID()}`, {
    familyId: stringField(input.familyId),
    kind: stringField("family_friend_accepted"),
    actorUid: stringField(input.actorUid),
    actorEmail: stringField(input.actorEmail),
    actorName: stringField(input.actorName),
    title: stringField(copy.title),
    message: stringField(copy.message),
    relatedIds: stringArrayField([input.actorUid, input.actorEmail].filter(Boolean)),
    createdAt: timestampField(now),
  });
}

async function getFamilyLocale(familyId: string) {
  try {
    return readString((await adminGetDocument(`families/${familyId}`)).fields, "defaultLocale") || "en-US";
  } catch {
    return "en-US";
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ inviteId: string }> },
) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { inviteId } = await context.params;
  let body: ActionBody = {};
  try {
    body = (await request.json()) as ActionBody;
  } catch {
    // An empty body means accept, which is the primary CTA.
  }
  const action = body.action === "resend" ? "resend" : "accept";

  try {
    const result = await runWithRefreshedFirebaseToken(session, async (idToken) => {
      const [familyContext, invite] = await Promise.all([
        getViewerFamilyContext(session.uid, session.email, idToken),
        getFamilyFriendInvite(inviteId),
      ]);
      if (!familyContext.familyId) return { kind: "family_not_found" as const };
      if (familyContext.viewerRole !== "admin") return { kind: "forbidden" as const };
      if (!invite) return { kind: "invite_not_found" as const };
      if (invite.status !== "pending") return { kind: "invite_not_pending" as const };

      if (action === "resend") {
        if (invite.fromFamilyId !== familyContext.familyId) return { kind: "forbidden" as const };
        const target = await findTargetAdminFamily(invite.toEmail);
        const token = createFamilyFriendToken();
        const now = new Date().toISOString();
        await adminPatchDocument(
          `familyFriendInvites/${inviteId}`,
          {
            tokenHash: stringField(hashFamilyFriendToken(token)),
            toFamilyId: stringField(target?.familyId || invite.toFamilyId),
            expiresAt: timestampField(familyFriendInviteExpiresAt(new Date(now))),
            updatedAt: timestampField(now),
          },
          ["tokenHash", "toFamilyId", "expiresAt", "updatedAt"],
        );
        const delivery = await notifyFamilyFriendInvite({
          inviteId,
          token,
          fromFamilyName: invite.fromFamilyName,
          fromAdminName: invite.fromAdminName,
          toEmail: invite.toEmail,
          toFamilyId: target?.familyId || invite.toFamilyId,
          targetAdminUid: target?.uid,
          locale: target?.locale,
        });
        void writeAuditLogBestEffort({
          familyId: familyContext.familyId,
          idToken,
          eventType: "family_friend_invite_resent",
          actor: { uid: session.uid, email: session.email, name: session.name, role: "admin" },
          source: "family_friends",
          requestId: inviteId,
        });
        return { kind: "resent" as const, delivery };
      }

      if (isFamilyFriendInviteExpired(invite.expiresAt)) return { kind: "invite_expired" as const };

      if (normalizeFriendEmail(session.email) !== invite.toEmail) {
        return { kind: "wrong_recipient" as const };
      }
      if (invite.toFamilyId && invite.toFamilyId !== familyContext.familyId) {
        return { kind: "wrong_recipient" as const };
      }
      if (invite.fromFamilyId === familyContext.familyId) return { kind: "same_family" as const };

      const [sourceFriends, targetFriends] = await Promise.all([
        listFamilyFriends(invite.fromFamilyId),
        listFamilyFriends(familyContext.familyId),
      ]);
      if (
        sourceFriends.some((friend) => friend.familyId === familyContext.familyId) ||
        targetFriends.some((friend) => friend.familyId === invite.fromFamilyId)
      ) {
        return { kind: "already_friends" as const };
      }
      if (sourceFriends.length >= MAX_FAMILY_FRIENDS || targetFriends.length >= MAX_FAMILY_FRIENDS) {
        return { kind: "friend_limit" as const };
      }

      const now = new Date().toISOString();
      const sourceFriendFields = {
        status: stringField("active"),
        friendFamilyId: stringField(familyContext.familyId),
        friendFamilyName: stringField(familyContext.familyName),
        sourceInviteId: stringField(inviteId),
        connectedByUid: stringField(session.uid),
        connectedAt: timestampField(now),
      };
      const targetFriendFields = {
        status: stringField("active"),
        friendFamilyId: stringField(invite.fromFamilyId),
        friendFamilyName: stringField(invite.fromFamilyName),
        sourceInviteId: stringField(inviteId),
        connectedByUid: stringField(session.uid),
        connectedAt: timestampField(now),
      };
      await adminCommitWrites([
        { update: { path: `families/${invite.fromFamilyId}/friends/${familyContext.familyId}`, fields: sourceFriendFields } },
        { update: { path: `families/${familyContext.familyId}/friends/${invite.fromFamilyId}`, fields: targetFriendFields } },
        {
          update: {
            path: `familyFriendInvites/${inviteId}`,
            fields: {
              status: stringField("accepted"),
              toFamilyId: stringField(familyContext.familyId),
              acceptedByUid: stringField(session.uid),
              acceptedAt: timestampField(now),
              updatedAt: timestampField(now),
            },
            updateMask: ["status", "toFamilyId", "acceptedByUid", "acceptedAt", "updatedAt"],
          },
        },
      ]);
      const [sourceLocale, targetLocale] = await Promise.all([
        getFamilyLocale(invite.fromFamilyId),
        getFamilyLocale(familyContext.familyId),
      ]);
      await Promise.allSettled([
        writeAcceptedNotification({
          familyId: invite.fromFamilyId,
          otherFamilyName: familyContext.familyName,
          actorUid: session.uid,
          actorEmail: session.email,
          actorName: session.name,
          locale: sourceLocale,
        }),
        writeAcceptedNotification({
          familyId: familyContext.familyId,
          otherFamilyName: invite.fromFamilyName,
          actorUid: session.uid,
          actorEmail: session.email,
          actorName: session.name,
          locale: targetLocale,
        }),
      ]);
      void writeAuditLogBestEffort({
        familyId: familyContext.familyId,
        idToken,
        eventType: "family_friend_accepted",
        actor: { uid: session.uid, email: session.email, name: session.name, role: "admin" },
        source: "family_friends",
        requestId: inviteId,
        next: { friendFamilyId: invite.fromFamilyId },
      });
      void writeCrossFamilyAuditBestEffort({
        familyId: invite.fromFamilyId,
        eventType: "family_friend_accepted",
        actor: { uid: session.uid, email: session.email, name: session.name },
        requestId: inviteId,
        friendFamilyId: familyContext.familyId,
      });
      return { kind: "accepted" as const };
    });

    if (result.data.kind !== "accepted" && result.data.kind !== "resent") {
      return responseForError(result.data.kind);
    }
    const response = NextResponse.json(result.data);
    if (result.data.kind === "accepted") {
      response.cookies.delete("pending_family_friend_invite");
    }
    if (result.refreshed) setSessionUserCookie(response, result.session);
    return response;
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 180) : "unknown";
    console.error("[FAMILY_FRIEND_INVITE_ACTION_ERROR]", reason);
    return NextResponse.json({ error: "family_friend_action_failed" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ inviteId: string }> },
) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { inviteId } = await context.params;
  try {
    const result = await runWithRefreshedFirebaseToken(session, async (idToken) => {
      const [familyContext, invite] = await Promise.all([
        getViewerFamilyContext(session.uid, session.email, idToken),
        getFamilyFriendInvite(inviteId),
      ]);
      if (!familyContext.familyId) return { kind: "family_not_found" as const };
      if (familyContext.viewerRole !== "admin") return { kind: "forbidden" as const };
      if (!invite) return { kind: "invite_not_found" as const };
      if (invite.fromFamilyId !== familyContext.familyId) return { kind: "forbidden" as const };
      if (invite.status !== "pending") return { kind: "invite_not_pending" as const };
      const now = new Date().toISOString();
      await adminPatchDocument(
        `familyFriendInvites/${inviteId}`,
        { status: stringField("cancelled"), updatedAt: timestampField(now) },
        ["status", "updatedAt"],
      );
      void writeAuditLogBestEffort({
        familyId: familyContext.familyId,
        idToken,
        eventType: "family_friend_invite_cancelled",
        actor: { uid: session.uid, email: session.email, name: session.name, role: "admin" },
        source: "family_friends",
        requestId: inviteId,
      });
      return { kind: "cancelled" as const };
    });
    if (result.data.kind !== "cancelled") return responseForError(result.data.kind);
    const response = NextResponse.json(result.data);
    if (result.refreshed) setSessionUserCookie(response, result.session);
    return response;
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 180) : "unknown";
    console.error("[FAMILY_FRIEND_INVITE_CANCEL_ERROR]", reason);
    return NextResponse.json({ error: "family_friend_cancel_failed" }, { status: 500 });
  }
}
