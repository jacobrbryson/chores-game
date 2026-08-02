import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { writeAuditLogBestEffort } from "@/lib/audit/log";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  createFamilyFriendToken,
  familyFriendInviteExpiresAt,
  hashFamilyFriendToken,
  isFamilyFriendInviteExpired,
  isLikelyFriendEmail,
  MAX_FAMILY_FRIENDS,
  normalizeFriendEmail,
} from "@/lib/family-friends/model";
import { notifyFamilyFriendInvite } from "@/lib/family-friends/notify";
import {
  findTargetAdminFamily,
  listFamilyFriendInvites,
  listFamilyFriends,
} from "@/lib/family-friends/repository";
import { getViewerFamilyContext } from "@/lib/family/member-access";
import { adminCreateOrReplaceDocument } from "@/lib/firestore/admin";
import { stringField, timestampField } from "@/lib/firestore/rest";

type InviteBody = { email?: unknown };

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

function mapError(error: unknown, fallback: string) {
  const reason = error instanceof Error ? error.message.slice(0, 180) : "unknown";
  console.error("[FAMILY_FRIENDS_ERROR]", reason);
  if (reason.includes("FIREBASE_REFRESH_FAILED") || reason.includes("HTTP_401")) {
    return NextResponse.json({ error: "reauth_required" }, { status: 401 });
  }
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) return unauthorized();

  try {
    const result = await runWithRefreshedFirebaseToken(session, async (idToken) => {
      const context = await getViewerFamilyContext(session.uid, session.email, idToken);
      if (!context.familyId) {
        return { viewerRole: "player" as const, friends: [], incoming: [], outgoing: [] };
      }
      const friends = await listFamilyFriends(context.familyId);
      if (context.viewerRole !== "admin") {
        return { viewerRole: context.viewerRole, friends, incoming: [], outgoing: [] };
      }
      const invites = await listFamilyFriendInvites(
        context.familyId,
        normalizeFriendEmail(session.email),
      );
      const serialize = (invite: (typeof invites.incoming)[number]) => ({
        id: invite.id,
        status: isFamilyFriendInviteExpired(invite.expiresAt) && invite.status === "pending" ? "expired" : invite.status,
        fromFamilyId: invite.fromFamilyId,
        fromFamilyName: invite.fromFamilyName,
        fromAdminName: invite.fromAdminName,
        toEmail: invite.toEmail,
        createdAt: invite.createdAt,
        expiresAt: invite.expiresAt,
      });
      return {
        viewerRole: context.viewerRole,
        friends,
        incoming: invites.incoming.map(serialize),
        outgoing: invites.outgoing.map(serialize),
      };
    });
    const response = NextResponse.json(result.data);
    if (result.refreshed) setSessionUserCookie(response, result.session);
    return response;
  } catch (error) {
    return mapError(error, "family_friends_unavailable");
  }
}

export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) return unauthorized();
  let body: InviteBody;
  try {
    body = (await request.json()) as InviteBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const targetEmail = normalizeFriendEmail(typeof body.email === "string" ? body.email : "");
  if (!isLikelyFriendEmail(targetEmail)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  try {
    const result = await runWithRefreshedFirebaseToken(session, async (idToken) => {
      const context = await getViewerFamilyContext(session.uid, session.email, idToken);
      if (!context.familyId) return { kind: "family_not_found" as const };
      if (context.viewerRole !== "admin") return { kind: "forbidden" as const };
      if (context.members.some((member) => normalizeFriendEmail(member.email) === targetEmail)) {
        return { kind: "same_family" as const };
      }

      const [friends, existingInvites, target] = await Promise.all([
        listFamilyFriends(context.familyId),
        listFamilyFriendInvites(context.familyId, normalizeFriendEmail(session.email)),
        findTargetAdminFamily(targetEmail),
      ]);
      if (friends.length >= MAX_FAMILY_FRIENDS) return { kind: "friend_limit" as const };
      if (target?.familyId && friends.some((friend) => friend.familyId === target.familyId)) {
        return { kind: "already_friends" as const };
      }
      const duplicate = existingInvites.outgoing.some(
        (invite) =>
          invite.toEmail === targetEmail &&
          invite.status === "pending" &&
          !isFamilyFriendInviteExpired(invite.expiresAt),
      );
      if (duplicate) return { kind: "invite_pending" as const };

      const inviteId = randomUUID();
      const token = createFamilyFriendToken();
      const now = new Date().toISOString();
      await adminCreateOrReplaceDocument(`familyFriendInvites/${inviteId}`, {
        status: stringField("pending"),
        fromFamilyId: stringField(context.familyId),
        fromFamilyName: stringField(context.familyName),
        fromAdminUid: stringField(session.uid),
        fromAdminName: stringField(session.name || context.viewerMember?.name || "A parent"),
        fromAdminEmail: stringField(normalizeFriendEmail(session.email)),
        toEmail: stringField(targetEmail),
        toFamilyId: stringField(target?.familyId || ""),
        tokenHash: stringField(hashFamilyFriendToken(token)),
        createdAt: timestampField(now),
        expiresAt: timestampField(familyFriendInviteExpiresAt(new Date(now))),
        updatedAt: timestampField(now),
      });
      const delivery = await notifyFamilyFriendInvite({
        inviteId,
        token,
        fromFamilyName: context.familyName,
        fromAdminName: session.name || context.viewerMember?.name || "A parent",
        toEmail: targetEmail,
        toFamilyId: target?.familyId,
        targetAdminUid: target?.uid,
        locale: target?.locale,
      });
      void writeAuditLogBestEffort({
        familyId: context.familyId,
        idToken,
        eventType: "family_friend_invited",
        actor: { uid: session.uid, email: session.email, name: session.name, role: "admin" },
        source: "family_friends",
        requestId: inviteId,
        next: { targetEmail, targetFamilyKnown: Boolean(target?.familyId) },
      });
      return { kind: "ok" as const, inviteId, delivery };
    });

    const data = result.data;
    const statusMap: Record<string, number> = {
      family_not_found: 404,
      forbidden: 403,
      same_family: 409,
      friend_limit: 409,
      already_friends: 409,
      invite_pending: 409,
    };
    if (data.kind !== "ok") {
      return NextResponse.json({ error: data.kind }, { status: statusMap[data.kind] || 400 });
    }
    const response = NextResponse.json({ inviteId: data.inviteId, delivery: data.delivery }, { status: 201 });
    if (result.refreshed) setSessionUserCookie(response, result.session);
    return response;
  } catch (error) {
    return mapError(error, "family_friend_invite_failed");
  }
}
