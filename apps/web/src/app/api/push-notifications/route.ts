import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  boolField,
  createOrReplaceDocument,
  deleteDocument,
  documentIdFromName,
  getDocument,
  listDocuments,
  patchDocument,
  readString,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";
import { getViewerFamilyContext } from "@/lib/family/member-access";
import {
  hasAnyPushNotificationEnabled,
  isPushPermissionState,
  normalizePushNotificationSettings,
  type PushNotificationType,
} from "@/lib/push/constants";
import { trackAchievementEvent } from "@/lib/achievements/service";
import {
  buildMemberPushSettingsFields,
  buildStoredPushSubscriptionFields,
  isPushSubscriptionJson,
  pushSubscriptionDocumentId,
  readMemberPushNotificationSettings,
  readMemberPushPermission,
  readStoredPushSubscriptionRecord,
} from "@/lib/push/subscriptions";
import { sendPushTestNotificationToUid } from "@/lib/push/delivery";
import { getPushPublicKey, isWebPushConfigured } from "@/lib/push/web-push";

type PushNotificationsPatchBody = {
  settings?: unknown;
  permission?: unknown;
  subscription?: unknown;
  unsubscribeEndpoint?: unknown;
};

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

function mapCommonFirestoreErrors(reason: string, fallbackError: string) {
  if (reason.includes("FIRESTORE_HTTP_401") || reason.includes("FIREBASE_REFRESH_FAILED")) {
    return jsonReauthRequired();
  }
  if (reason.includes("FIRESTORE_HTTP_403")) {
    return jsonFirestoreForbidden();
  }
  return NextResponse.json({ error: fallbackError }, { status: 500 });
}

function parseSettings(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.choreCompleted !== "boolean" ||
    typeof candidate.rewardClaimed !== "boolean" ||
    typeof candidate.choreApprovalRequired !== "boolean"
  ) {
    return null;
  }
  // achievementUnlocked arrived after the first three toggles shipped: a client
  // that predates it stays valid and simply leaves that toggle off.
  if (
    candidate.achievementUnlocked !== undefined &&
    typeof candidate.achievementUnlocked !== "boolean"
  ) {
    return null;
  }
  return normalizePushNotificationSettings({
    choreCompleted: candidate.choreCompleted,
    rewardClaimed: candidate.rewardClaimed,
    choreApprovalRequired: candidate.choreApprovalRequired,
    achievementUnlocked: candidate.achievementUnlocked === true,
  });
}

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "not_allowed" }, { status: 403 });
  }

  try {
    const { data, session: refreshedSession, refreshed } = await runWithRefreshedFirebaseToken(
      session,
      async (idToken) => {
        const familyContext = await getViewerFamilyContext(session.uid, session.email, idToken);
        if (!familyContext.familyId || !familyContext.viewerMember) {
          return { kind: "family_not_found" as const };
        }
        if (familyContext.viewerRole !== "admin") {
          return { kind: "forbidden" as const };
        }

        const memberDoc = await getDocument(
          `families/${familyContext.familyId}/members/${familyContext.viewerMember.id}`,
          idToken,
        );
        const ownSubscriptionDocs = (
          await listDocuments(`families/${familyContext.familyId}/pushSubscriptions`, idToken, 100)
        )
          .map((doc) => readStoredPushSubscriptionRecord(documentIdFromName(doc.name), doc.fields))
          .filter((entry) => entry?.uid === session.uid);

        return {
          kind: "ok" as const,
          configured: isWebPushConfigured(),
          vapidPublicKey: getPushPublicKey(),
          permission: readMemberPushPermission(memberDoc.fields),
          settings: readMemberPushNotificationSettings(memberDoc.fields),
          hasStoredSubscription: ownSubscriptionDocs.length > 0,
          subscriptionCount: ownSubscriptionDocs.length,
        };
      },
    );

    if (data.kind === "family_not_found") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    if (data.kind === "forbidden") {
      return NextResponse.json({ error: "not_allowed" }, { status: 403 });
    }

    const response = NextResponse.json(data);
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[PUSH_NOTIFICATIONS_GET_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "push_notifications_unavailable");
  }
}

export async function PATCH(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "not_allowed" }, { status: 403 });
  }

  let body: PushNotificationsPatchBody;
  try {
    body = (await request.json()) as PushNotificationsPatchBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const hasSettings = body.settings !== undefined;
  const settings = hasSettings ? parseSettings(body.settings) : null;
  if (hasSettings && !settings) {
    return NextResponse.json({ error: "invalid_push_notification_settings" }, { status: 400 });
  }

  const permission = body.permission;
  if (permission !== undefined && !isPushPermissionState(permission)) {
    return NextResponse.json({ error: "invalid_push_notification_permission" }, { status: 400 });
  }

  const subscription = body.subscription;
  if (subscription !== undefined && subscription !== null && !isPushSubscriptionJson(subscription)) {
    return NextResponse.json({ error: "invalid_push_subscription" }, { status: 400 });
  }
  const normalizedSubscription = isPushSubscriptionJson(subscription) ? subscription : undefined;

  const unsubscribeEndpoint =
    typeof body.unsubscribeEndpoint === "string" ? body.unsubscribeEndpoint.trim() : "";
  if (!hasSettings && permission === undefined && subscription === undefined && !unsubscribeEndpoint) {
    return NextResponse.json({ error: "no_push_notification_updates" }, { status: 400 });
  }

  try {
    const { session: refreshedSession, refreshed } = await runWithRefreshedFirebaseToken(
      session,
      async (idToken) => {
        const familyContext = await getViewerFamilyContext(session.uid, session.email, idToken);
        if (!familyContext.familyId || !familyContext.viewerMember) {
          throw new Error("FAMILY_NOT_FOUND");
        }
        if (familyContext.viewerRole !== "admin") {
          throw new Error("FORBIDDEN");
        }

        const memberDocPath = `families/${familyContext.familyId}/members/${familyContext.viewerMember.id}`;
        const memberDoc = await getDocument(memberDocPath, idToken);
        const nextSettings = settings ?? readMemberPushNotificationSettings(memberDoc.fields);
        const nextPermission =
          permission ?? readMemberPushPermission(memberDoc.fields);
        const now = new Date().toISOString();

        const memberPatch = buildMemberPushSettingsFields(nextSettings, nextPermission, now);
        await patchDocument(memberDocPath, memberPatch.fields, idToken, memberPatch.updateMask);

        const existingSubscriptionDocs = await listDocuments(
          `families/${familyContext.familyId}/pushSubscriptions`,
          idToken,
          100,
        );
        const ownSubscriptionDocIds = existingSubscriptionDocs
          .map((doc) => ({
            id: documentIdFromName(doc.name),
            uid: readString(doc.fields, "uid"),
          }))
          .filter((entry) => entry.uid === session.uid)
          .map((entry) => entry.id);

        await Promise.all(
          ownSubscriptionDocIds.map((docId) =>
            patchDocument(
              `families/${familyContext.familyId}/pushSubscriptions/${docId}`,
              {
                pushNotifyChoreCompleted: boolField(nextSettings.choreCompleted),
                pushNotifyRewardClaimed: boolField(nextSettings.rewardClaimed),
                pushNotifyChoreApprovalRequired: boolField(nextSettings.choreApprovalRequired),
                permission: stringField(nextPermission),
                updatedAt: timestampField(now),
              },
              idToken,
              [
                "pushNotifyChoreCompleted",
                "pushNotifyRewardClaimed",
                "pushNotifyChoreApprovalRequired",
                "permission",
                "updatedAt",
              ],
            ),
          ),
        );

        if (normalizedSubscription && hasAnyPushNotificationEnabled(nextSettings)) {
          const docId = pushSubscriptionDocumentId(normalizedSubscription.endpoint);
          await createOrReplaceDocument(
            `families/${familyContext.familyId}/pushSubscriptions/${docId}`,
            buildStoredPushSubscriptionFields({
              familyId: familyContext.familyId,
              uid: session.uid,
              settings: nextSettings,
              permission: nextPermission,
              subscription: normalizedSubscription,
              now,
            }),
            idToken,
          );
        }

        if (unsubscribeEndpoint) {
          try {
            await deleteDocument(
              `families/${familyContext.familyId}/pushSubscriptions/${pushSubscriptionDocumentId(unsubscribeEndpoint)}`,
              idToken,
            );
          } catch (error) {
            const reason = error instanceof Error ? error.message : "";
            if (!reason.includes("FIRESTORE_HTTP_404")) {
              throw error;
            }
          }
        }
        if (hasAnyPushNotificationEnabled(nextSettings)) {
          await trackAchievementEvent({
            uid: session.uid,
            familyId: familyContext.familyId,
            idToken,
            viewerRole: "admin",
            eventId: "admin_push_notifications_enabled",
            metricDeltas: {
              admin_push_notifications_enabled: 1,
            },
          });
        }

        return null;
      },
    );

    const response = NextResponse.json({ success: true });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[PUSH_NOTIFICATIONS_PATCH_ERROR]", reason);
    if (reason.includes("FAMILY_NOT_FOUND")) {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    if (reason.includes("FORBIDDEN")) {
      return NextResponse.json({ error: "not_allowed" }, { status: 403 });
    }
    return mapCommonFirestoreErrors(reason, "push_notifications_update_failed");
  }
}

function resolveSampleContent(type: PushNotificationType) {
  if (type === "reward_claimed") {
    return {
      title: "Sample prize claim notification",
      body: "This sample confirms prize-claim push notifications are working.",
    };
  }
  if (type === "chore_approval_required") {
    return {
      title: "Sample approval-required notification",
      body: "This sample confirms approval-request push notifications are working.",
    };
  }
  if (type === "achievement_unlocked") {
    return {
      title: "Sample achievement notification",
      body: "This sample confirms achievement-unlocked push notifications are working.",
    };
  }
  return {
    title: "Sample chore completed notification",
    body: "This sample confirms chore-completed push notifications are working.",
  };
}

export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "not_allowed" }, { status: 403 });
  }

  let body: { action?: unknown; type?: unknown };
  try {
    body = (await request.json()) as { action?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (body.action !== "send_test") {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }
  const type =
    body.type === "reward_claimed" ||
    body.type === "chore_approval_required" ||
    body.type === "chore_completed" ||
    body.type === "achievement_unlocked"
      ? body.type
      : null;
  if (!type) {
    return NextResponse.json({ error: "invalid_push_notification_type" }, { status: 400 });
  }

  try {
    const { data, session: refreshedSession, refreshed } = await runWithRefreshedFirebaseToken(
      session,
      async (idToken) => {
        const familyContext = await getViewerFamilyContext(session.uid, session.email, idToken);
        if (!familyContext.familyId || !familyContext.viewerMember) {
          return { kind: "family_not_found" as const };
        }
        if (familyContext.viewerRole !== "admin") {
          return { kind: "forbidden" as const };
        }

        const sample = resolveSampleContent(type);
        const result = await sendPushTestNotificationToUid({
          familyId: familyContext.familyId,
          idToken,
          uid: session.uid,
          title: sample.title,
          body: sample.body,
        });

        return { kind: "ok" as const, recipientCount: result.recipientCount };
      },
    );

    if (data.kind === "family_not_found") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    if (data.kind === "forbidden") {
      return NextResponse.json({ error: "not_allowed" }, { status: 403 });
    }

    const response = NextResponse.json({ success: true, recipientCount: data.recipientCount });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[PUSH_NOTIFICATIONS_TEST_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "push_notifications_test_failed");
  }
}
