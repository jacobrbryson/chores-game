import { createHash } from "node:crypto";
import type { FirestoreValue } from "@/lib/firestore/rest";
import {
  boolField,
  readBoolean,
  readString,
  readTimestamp,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";
import { decryptPushSubscriptionPayload, encryptPushSubscriptionPayload } from "@/lib/push/crypto";
import {
  isPushPermissionState,
  normalizePushNotificationSettings,
  type PushNotificationSettings,
  type PushPermissionState,
} from "@/lib/push/constants";

// Native (Expo) push registrations. Web browsers hand us a Web Push
// subscription (endpoint + keys) stored under `pushSubscriptions`; the Expo
// app hands us a single opaque device token instead, so it gets its own
// collection rather than bending the web-push record shape around it.
export const PUSH_DEVICE_PLATFORMS = ["ios", "android", "unknown"] as const;

export type PushDevicePlatform = (typeof PUSH_DEVICE_PLATFORMS)[number];

export type StoredPushDeviceRecord = {
  id: string;
  uid: string;
  platform: PushDevicePlatform;
  permission: PushPermissionState;
  settings: PushNotificationSettings;
  expoPushToken: string;
  updatedAt?: string;
};

export function isPushDevicePlatform(value: unknown): value is PushDevicePlatform {
  return typeof value === "string" && PUSH_DEVICE_PLATFORMS.includes(value as PushDevicePlatform);
}

// Expo push tokens look like `ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]`.
export function isExpoPushToken(value: unknown): value is string {
  return typeof value === "string" && /^Expo(nent)?PushToken\[[^\]]+\]$/.test(value.trim());
}

export function pushDeviceDocumentId(expoPushToken: string) {
  return createHash("sha256").update(expoPushToken.trim()).digest("hex");
}

export function buildStoredPushDeviceFields(input: {
  familyId: string;
  uid: string;
  platform: PushDevicePlatform;
  permission: PushPermissionState;
  settings: PushNotificationSettings;
  expoPushToken: string;
  now: string;
}) {
  return {
    familyId: stringField(input.familyId),
    uid: stringField(input.uid),
    platform: stringField(input.platform),
    permission: stringField(input.permission),
    pushNotifyChoreCompleted: boolField(input.settings.choreCompleted),
    pushNotifyRewardClaimed: boolField(input.settings.rewardClaimed),
    pushNotifyChoreApprovalRequired: boolField(input.settings.choreApprovalRequired),
    pushNotifyAchievementUnlocked: boolField(input.settings.achievementUnlocked),
    deviceTokenCiphertext: stringField(encryptPushSubscriptionPayload(input.expoPushToken.trim())),
    tokenHash: stringField(pushDeviceDocumentId(input.expoPushToken)),
    createdAt: timestampField(input.now),
    updatedAt: timestampField(input.now),
  };
}

export function readStoredPushDeviceRecord(
  id: string,
  fields: Record<string, FirestoreValue> | undefined,
): StoredPushDeviceRecord | null {
  const uid = readString(fields, "uid");
  const ciphertext = readString(fields, "deviceTokenCiphertext");
  if (!uid || !ciphertext) {
    return null;
  }
  let expoPushToken: string;
  try {
    expoPushToken = decryptPushSubscriptionPayload(ciphertext);
  } catch {
    return null;
  }
  if (!isExpoPushToken(expoPushToken)) {
    return null;
  }
  const platform = readString(fields, "platform");
  const permission = readString(fields, "permission");
  return {
    id,
    uid,
    platform: isPushDevicePlatform(platform) ? platform : "unknown",
    permission: isPushPermissionState(permission) ? permission : "default",
    settings: normalizePushNotificationSettings({
      choreCompleted: readBoolean(fields, "pushNotifyChoreCompleted"),
      rewardClaimed: readBoolean(fields, "pushNotifyRewardClaimed"),
      choreApprovalRequired: readBoolean(fields, "pushNotifyChoreApprovalRequired"),
      achievementUnlocked: readBoolean(fields, "pushNotifyAchievementUnlocked"),
    }),
    expoPushToken,
    updatedAt: readTimestamp(fields, "updatedAt") || undefined,
  };
}
