import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { getAuthenticatedSessionIdentity } from "@/lib/auth/session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  createOrReplaceDocument,
  deleteDocument,
  documentIdFromName,
  getDocument,
  listDocuments,
} from "@/lib/firestore/rest";
import { getViewerFamilyContext } from "@/lib/family/member-access";
import {
  DEFAULT_PUSH_NOTIFICATION_SETTINGS,
  isPushPermissionState,
  normalizePushNotificationSettings,
  type PushNotificationSettings,
} from "@/lib/push/constants";
import {
  buildStoredPushDeviceFields,
  isExpoPushToken,
  isPushDevicePlatform,
  pushDeviceDocumentId,
  readStoredPushDeviceRecord,
  type PushDevicePlatform,
} from "@/lib/push/devices";

type PushDevicesRequestBody = {
  expoPushToken?: unknown;
  platform?: unknown;
  permission?: unknown;
  settings?: unknown;
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

function mapCommonFirestoreErrors(reason: string, fallbackError: string) {
  if (reason.includes("FIRESTORE_HTTP_401") || reason.includes("FIREBASE_REFRESH_FAILED")) {
    return jsonReauthRequired();
  }
  if (reason.includes("FIRESTORE_HTTP_403")) {
    return NextResponse.json(
      {
        error: "firestore_forbidden",
        message:
          "Authenticated user does not have access to Firestore documents under current rules.",
      },
      { status: 403 },
    );
  }
  if (reason.includes("FAMILY_NOT_FOUND")) {
    return NextResponse.json({ error: "family_not_found" }, { status: 404 });
  }
  return NextResponse.json({ error: fallbackError }, { status: 500 });
}

function parseSettings(value: unknown): PushNotificationSettings | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const keys = [
    "choreCompleted",
    "rewardClaimed",
    "choreApprovalRequired",
    "achievementUnlocked",
  ] as const;
  for (const key of keys) {
    if (candidate[key] !== undefined && typeof candidate[key] !== "boolean") {
      return null;
    }
  }
  return normalizePushNotificationSettings({
    choreCompleted: candidate.choreCompleted === true,
    rewardClaimed: candidate.rewardClaimed === true,
    choreApprovalRequired: candidate.choreApprovalRequired === true,
    achievementUnlocked: candidate.achievementUnlocked === true,
  });
}

// Device registrations belong to the account that actually signed in on this
// device, not to whoever the session is currently switched into: Firestore
// rules match the document's uid against the Firebase token uid, and a switched
// session still carries the authenticated user's token.
function resolveDeviceOwner(session: ReturnType<typeof getSessionFromRequest>) {
  if (!session) {
    return { uid: "", email: "" };
  }
  const identity = getAuthenticatedSessionIdentity(session);
  return { uid: identity.uid, email: identity.email };
}

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }
  const owner = resolveDeviceOwner(session);

  try {
    const { data, session: refreshedSession, refreshed } = await runWithRefreshedFirebaseToken(
      session,
      async (idToken) => {
        const familyContext = await getViewerFamilyContext(owner.uid, owner.email, idToken);
        if (!familyContext.familyId) {
          throw new Error("FAMILY_NOT_FOUND");
        }
        const devices = (
          await listDocuments(`families/${familyContext.familyId}/pushDevices`, idToken, 100)
        )
          .map((doc) => readStoredPushDeviceRecord(documentIdFromName(doc.name), doc.fields))
          .filter((entry) => entry?.uid === owner.uid);

        return {
          uid: owner.uid,
          deviceCount: devices.length,
          // The token itself never leaves the server; the client already has it.
          devices: devices.map((device) => ({
            id: device?.id ?? "",
            platform: device?.platform ?? "unknown",
            permission: device?.permission ?? "default",
            settings: device?.settings ?? normalizePushNotificationSettings(null),
            updatedAt: device?.updatedAt ?? "",
          })),
        };
      },
    );

    const response = NextResponse.json(data);
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[PUSH_DEVICES_GET_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "push_devices_unavailable");
  }
}

export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }
  const owner = resolveDeviceOwner(session);

  let body: PushDevicesRequestBody;
  try {
    body = (await request.json()) as PushDevicesRequestBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const expoPushToken = typeof body.expoPushToken === "string" ? body.expoPushToken.trim() : "";
  if (!isExpoPushToken(expoPushToken)) {
    return NextResponse.json({ error: "invalid_expo_push_token" }, { status: 400 });
  }
  const platform: PushDevicePlatform = isPushDevicePlatform(body.platform)
    ? body.platform
    : "unknown";
  const permission = isPushPermissionState(body.permission) ? body.permission : "granted";
  const settings = parseSettings(body.settings);
  if (body.settings !== undefined && !settings) {
    return NextResponse.json({ error: "invalid_push_notification_settings" }, { status: 400 });
  }

  try {
    const { data, session: refreshedSession, refreshed } = await runWithRefreshedFirebaseToken(
      session,
      async (idToken) => {
        const familyContext = await getViewerFamilyContext(owner.uid, owner.email, idToken);
        if (!familyContext.familyId) {
          throw new Error("FAMILY_NOT_FOUND");
        }
        const deviceId = pushDeviceDocumentId(expoPushToken);
        const devicePath = `families/${familyContext.familyId}/pushDevices/${deviceId}`;
        // The app re-registers on every launch (Expo rotates tokens) without
        // sending settings. That refresh must not silently reset the toggles
        // this device already chose, so they are carried forward.
        let nextSettings = settings;
        if (!nextSettings) {
          const existing = await getDocument(devicePath, idToken).catch(() => null);
          nextSettings =
            readStoredPushDeviceRecord(deviceId, existing?.fields)?.settings ??
            DEFAULT_PUSH_NOTIFICATION_SETTINGS;
        }
        const now = new Date().toISOString();
        await createOrReplaceDocument(
          devicePath,
          buildStoredPushDeviceFields({
            familyId: familyContext.familyId,
            uid: owner.uid,
            platform,
            permission,
            settings: nextSettings,
            expoPushToken,
            now,
          }),
          idToken,
        );
        return { deviceId, platform, permission };
      },
    );

    const response = NextResponse.json(data);
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[PUSH_DEVICES_POST_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "push_device_registration_failed");
  }
}

export async function DELETE(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }
  const owner = resolveDeviceOwner(session);

  let body: PushDevicesRequestBody;
  try {
    body = (await request.json()) as PushDevicesRequestBody;
  } catch {
    body = {};
  }
  const expoPushToken = typeof body.expoPushToken === "string" ? body.expoPushToken.trim() : "";

  try {
    const { data, session: refreshedSession, refreshed } = await runWithRefreshedFirebaseToken(
      session,
      async (idToken) => {
        const familyContext = await getViewerFamilyContext(owner.uid, owner.email, idToken);
        if (!familyContext.familyId) {
          throw new Error("FAMILY_NOT_FOUND");
        }
        // With a token, retire just that device. Without one — the app was
        // signed out before it could read its token back — retire every device
        // this account registered.
        const ownDeviceIds = expoPushToken
          ? [pushDeviceDocumentId(expoPushToken)]
          : (await listDocuments(`families/${familyContext.familyId}/pushDevices`, idToken, 100))
              .map((doc) => readStoredPushDeviceRecord(documentIdFromName(doc.name), doc.fields))
              .filter((entry) => entry?.uid === owner.uid)
              .map((entry) => entry?.id ?? "")
              .filter(Boolean);

        await Promise.all(
          ownDeviceIds.map((id) =>
            deleteDocument(`families/${familyContext.familyId}/pushDevices/${id}`, idToken),
          ),
        );
        return { removed: ownDeviceIds.length };
      },
    );

    const response = NextResponse.json(data);
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[PUSH_DEVICES_DELETE_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "push_device_removal_failed");
  }
}
