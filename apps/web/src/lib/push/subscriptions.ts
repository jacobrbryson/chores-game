import { createHash } from "node:crypto";
import type { FirestoreValue } from "@/lib/firestore/rest";
import { boolField, readBoolean, readString, readTimestamp, stringField, timestampField } from "@/lib/firestore/rest";
import { decryptPushSubscriptionPayload, encryptPushSubscriptionPayload } from "@/lib/push/crypto";
import {
  DEFAULT_PUSH_NOTIFICATION_SETTINGS,
  isPushPermissionState,
  normalizePushNotificationSettings,
  type PushNotificationSettings,
  type PushPermissionState,
} from "@/lib/push/constants";

export type StoredPushSubscriptionRecord = {
  id: string;
  uid: string;
  settings: PushNotificationSettings;
  permission: PushPermissionState;
  subscription: PushSubscriptionJSON;
  updatedAt?: string;
};

export type ValidPushSubscriptionJson = PushSubscriptionJSON & {
  endpoint: string;
  keys: {
    auth: string;
    p256dh: string;
  };
};

export function pushSubscriptionDocumentId(endpoint: string) {
  return createHash("sha256").update(endpoint.trim()).digest("hex");
}

export function isPushSubscriptionJson(value: unknown): value is ValidPushSubscriptionJson {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as PushSubscriptionJSON;
  return (
    typeof candidate.endpoint === "string" &&
    candidate.endpoint.trim().length > 0 &&
    Boolean(candidate.keys) &&
    typeof candidate.keys?.auth === "string" &&
    candidate.keys.auth.length > 0 &&
    typeof candidate.keys?.p256dh === "string" &&
    candidate.keys.p256dh.length > 0
  );
}

export function readMemberPushNotificationSettings(
  fields: Record<string, FirestoreValue> | undefined,
): PushNotificationSettings {
  return normalizePushNotificationSettings({
    choreCompleted: readBoolean(fields, "pushNotifyChoreCompleted"),
    rewardClaimed: readBoolean(fields, "pushNotifyRewardClaimed"),
    choreApprovalRequired: readBoolean(fields, "pushNotifyChoreApprovalRequired"),
  });
}

export function readMemberPushPermission(
  fields: Record<string, FirestoreValue> | undefined,
): PushPermissionState {
  const value = readString(fields, "pushNotificationPermission");
  return isPushPermissionState(value) ? value : "default";
}

export function buildMemberPushSettingsFields(
  settings: PushNotificationSettings,
  permission: PushPermissionState,
  now: string,
) {
  return {
    fields: {
      pushNotifyChoreCompleted: boolField(settings.choreCompleted),
      pushNotifyRewardClaimed: boolField(settings.rewardClaimed),
      pushNotifyChoreApprovalRequired: boolField(settings.choreApprovalRequired),
      pushNotificationPermission: stringField(permission),
      pushNotificationsUpdatedAt: timestampField(now),
    },
    updateMask: [
      "pushNotifyChoreCompleted",
      "pushNotifyRewardClaimed",
      "pushNotifyChoreApprovalRequired",
      "pushNotificationPermission",
      "pushNotificationsUpdatedAt",
    ],
  };
}

export function buildStoredPushSubscriptionFields(input: {
  familyId: string;
  uid: string;
  settings: PushNotificationSettings;
  permission: PushPermissionState;
  subscription: ValidPushSubscriptionJson;
  now: string;
}) {
  return {
    familyId: stringField(input.familyId),
    uid: stringField(input.uid),
    permission: stringField(input.permission),
    pushNotifyChoreCompleted: boolField(input.settings.choreCompleted),
    pushNotifyRewardClaimed: boolField(input.settings.rewardClaimed),
    pushNotifyChoreApprovalRequired: boolField(input.settings.choreApprovalRequired),
    subscriptionCiphertext: stringField(
      encryptPushSubscriptionPayload(JSON.stringify(input.subscription)),
    ),
    endpointHash: stringField(pushSubscriptionDocumentId(input.subscription.endpoint)),
    createdAt: timestampField(input.now),
    updatedAt: timestampField(input.now),
  };
}

export function readStoredPushSubscriptionRecord(
  id: string,
  fields: Record<string, FirestoreValue> | undefined,
): StoredPushSubscriptionRecord | null {
  const uid = readString(fields, "uid");
  const permission = readMemberPushPermission(fields);
  const ciphertext = readString(fields, "subscriptionCiphertext");
  if (!uid || !ciphertext) {
    return null;
  }
  let parsed: unknown;
  try {
    const decrypted = decryptPushSubscriptionPayload(ciphertext);
    parsed = JSON.parse(decrypted) as unknown;
  } catch {
    return null;
  }
  if (!isPushSubscriptionJson(parsed)) {
    return null;
  }
  return {
    id,
    uid,
    permission,
    settings: readMemberPushNotificationSettings(fields) || DEFAULT_PUSH_NOTIFICATION_SETTINGS,
    subscription: parsed,
    updatedAt: readTimestamp(fields, "updatedAt") || undefined,
  };
}
