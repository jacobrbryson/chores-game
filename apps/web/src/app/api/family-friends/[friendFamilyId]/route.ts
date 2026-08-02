import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { writeAuditLogBestEffort } from "@/lib/audit/log";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import { writeCrossFamilyAuditBestEffort } from "@/lib/family-friends/audit";
import { familyFriendStatusCopy } from "@/lib/family-friends/notify";
import { listFamilyFriends } from "@/lib/family-friends/repository";
import { getViewerFamilyContext } from "@/lib/family/member-access";
import { adminCommitWrites, adminCreateOrReplaceDocument, adminGetDocument } from "@/lib/firestore/admin";
import { readString, stringArrayField, stringField, timestampField } from "@/lib/firestore/rest";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ friendFamilyId: string }> },
) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { friendFamilyId } = await context.params;
  try {
    const result = await runWithRefreshedFirebaseToken(session, async (idToken) => {
      const familyContext = await getViewerFamilyContext(session.uid, session.email, idToken);
      if (!familyContext.familyId) return { kind: "family_not_found" as const };
      if (familyContext.viewerRole !== "admin") return { kind: "forbidden" as const };
      const friend = (await listFamilyFriends(familyContext.familyId)).find(
        (entry) => entry.familyId === friendFamilyId,
      );
      if (!friend) return { kind: "friend_not_found" as const };
      await adminCommitWrites([
        { delete: { path: `families/${familyContext.familyId}/friends/${friendFamilyId}` } },
        { delete: { path: `families/${friendFamilyId}/friends/${familyContext.familyId}` } },
      ]);
      const now = new Date().toISOString();
      let friendLocale = "en-US";
      try {
        friendLocale = readString((await adminGetDocument(`families/${friendFamilyId}`)).fields, "defaultLocale") || friendLocale;
      } catch {
        // Notification localization is best effort; relationship removal already succeeded.
      }
      const copy = familyFriendStatusCopy(friendLocale, "removed", familyContext.familyName);
      await adminCreateOrReplaceDocument(`families/${friendFamilyId}/notifications/${randomUUID()}`, {
        familyId: stringField(friendFamilyId),
        kind: stringField("family_friend_removed"),
        actorUid: stringField(session.uid),
        actorEmail: stringField(session.email),
        actorName: stringField(session.name),
        title: stringField(copy.title),
        message: stringField(copy.message),
        relatedIds: stringArrayField([session.uid, session.email].filter(Boolean)),
        createdAt: timestampField(now),
      });
      void writeAuditLogBestEffort({
        familyId: familyContext.familyId,
        idToken,
        eventType: "family_friend_removed",
        actor: { uid: session.uid, email: session.email, name: session.name, role: "admin" },
        source: "family_friends",
        next: { friendFamilyId },
      });
      void writeCrossFamilyAuditBestEffort({
        familyId: friendFamilyId,
        eventType: "family_friend_removed",
        actor: { uid: session.uid, email: session.email, name: session.name },
        friendFamilyId: familyContext.familyId,
      });
      return { kind: "removed" as const };
    });
    if (result.data.kind !== "removed") {
      const status = result.data.kind === "forbidden" ? 403 : 404;
      return NextResponse.json({ error: result.data.kind }, { status });
    }
    const response = NextResponse.json(result.data);
    if (result.refreshed) setSessionUserCookie(response, result.session);
    return response;
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 180) : "unknown";
    console.error("[FAMILY_FRIEND_REMOVE_ERROR]", reason);
    return NextResponse.json({ error: "family_friend_remove_failed" }, { status: 500 });
  }
}
