import { deleteDocument, documentIdFromName, listDocuments } from "@/lib/firestore/rest";
import {
  pushNotificationTargetUrl,
  pushSettingsAllowType,
  type PushNotificationType,
} from "@/lib/push/constants";
import { readStoredPushDeviceRecord, type StoredPushDeviceRecord } from "@/lib/push/devices";
import { sendExpoPushNotifications } from "@/lib/push/expo";
import { readStoredPushSubscriptionRecord } from "@/lib/push/subscriptions";
import { isWebPushConfigured, sendWebPushNotification } from "@/lib/push/web-push";

type SendFamilyPushNotificationsInput = {
  familyId: string;
  idToken: string;
  actorUid: string;
  type: PushNotificationType;
  title: string;
  body: string;
};

type PushPayload = { title: string; body: string; url: string; tag: string };

type ResolvedPushRecipient = NonNullable<
  ReturnType<typeof readStoredPushSubscriptionRecord>
>;

async function listResolvedPushRecipients(familyId: string, idToken: string) {
  const docs = await listDocuments(`families/${familyId}/pushSubscriptions`, idToken, 300);
  return docs
    .map((doc) => readStoredPushSubscriptionRecord(documentIdFromName(doc.name), doc.fields))
    .flatMap((entry) => (entry ? [entry] : []));
}

// Native (Expo) app registrations live alongside the browser ones. A family
// with no mobile installs simply has an empty collection, so this stays cheap.
async function listResolvedPushDevices(familyId: string, idToken: string) {
  const docs = await listDocuments(`families/${familyId}/pushDevices`, idToken, 300);
  return docs
    .map((doc) => readStoredPushDeviceRecord(documentIdFromName(doc.name), doc.fields))
    .flatMap((entry) => (entry ? [entry] : []));
}

async function loadPushRegistrations(familyId: string, idToken: string) {
  const [subscriptions, devices] = await Promise.all([
    isWebPushConfigured()
      ? listResolvedPushRecipients(familyId, idToken)
      : Promise.resolve([] as ResolvedPushRecipient[]),
    listResolvedPushDevices(familyId, idToken),
  ]);
  return { subscriptions, devices };
}

async function sendWebPushPayload(recipients: ResolvedPushRecipient[], payload: PushPayload) {
  if (recipients.length === 0) {
    return;
  }

  const results = await Promise.allSettled(
    recipients.map((recipient) => sendWebPushNotification(recipient.subscription, payload)),
  );

  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      return;
    }
    const recipient = recipients[index];
    const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
    console.error(
      "[PUSH_NOTIFICATION_SEND_ERROR]",
      JSON.stringify({
        uid: recipient.uid,
        subscriptionId: recipient.id,
        endpoint: recipient.subscription.endpoint,
        reason,
      }),
    );
  });
}

async function sendDevicePushPayload(
  familyId: string,
  idToken: string,
  devices: StoredPushDeviceRecord[],
  payload: PushPayload,
) {
  if (devices.length === 0) {
    return;
  }

  const { invalidTokens } = await sendExpoPushNotifications(
    devices.map((device) => ({
      to: device.expoPushToken,
      title: payload.title,
      body: payload.body,
      // The app reads `url` when the notification is tapped so it opens the
      // same place the web notification does.
      data: { url: payload.url, tag: payload.tag },
      channelId: "default",
    })),
  );

  // Expo reports uninstalled or revoked devices as DeviceNotRegistered. Drop
  // those registrations so a dead device stops costing a send every time.
  const staleIds = devices
    .filter((device) => invalidTokens.includes(device.expoPushToken))
    .map((device) => device.id);
  await Promise.allSettled(
    staleIds.map((id) => deleteDocument(`families/${familyId}/pushDevices/${id}`, idToken)),
  );
}

async function sendToAllTransports(input: {
  familyId: string;
  idToken: string;
  recipients: ResolvedPushRecipient[];
  devices: StoredPushDeviceRecord[];
  payload: PushPayload;
}) {
  await Promise.all([
    sendWebPushPayload(input.recipients, input.payload),
    sendDevicePushPayload(input.familyId, input.idToken, input.devices, input.payload),
  ]);
}

export async function sendFamilyPushNotifications(input: SendFamilyPushNotificationsInput) {
  const { subscriptions, devices } = await loadPushRegistrations(input.familyId, input.idToken);

  const recipients = subscriptions
    .filter((entry) => entry.uid !== input.actorUid)
    .filter((entry) => pushSettingsAllowType(entry.settings, input.type));
  const deviceRecipients = devices
    .filter((entry) => entry.uid !== input.actorUid)
    .filter((entry) => pushSettingsAllowType(entry.settings, input.type));

  console.info(
    "[PUSH_NOTIFICATION_DEBUG]",
    JSON.stringify({
      kind: input.type,
      familyId: input.familyId,
      totalRecipients: recipients.length,
      totalDevices: deviceRecipients.length,
    }),
  );

  await sendToAllTransports({
    familyId: input.familyId,
    idToken: input.idToken,
    recipients,
    devices: deviceRecipients,
    payload: {
      title: input.title,
      body: input.body,
      url: pushNotificationTargetUrl(input.type),
      tag: `family-chores-${input.type}`,
    },
  });
}

// An achievement unlock is addressed to the person who earned it, not to the
// rest of the family — and the earner is often not whoever triggered it (a
// parent approving a chore can complete a child's achievement). So this targets
// one uid instead of excluding the actor the way family broadcasts do.
export async function sendAchievementUnlockedPush(input: {
  familyId: string;
  idToken: string;
  uid: string;
  title: string;
  body: string;
}) {
  const { subscriptions, devices } = await loadPushRegistrations(input.familyId, input.idToken);

  const recipients = subscriptions
    .filter((entry) => entry.uid === input.uid)
    .filter((entry) => pushSettingsAllowType(entry.settings, "achievement_unlocked"));
  const deviceRecipients = devices
    .filter((entry) => entry.uid === input.uid)
    .filter((entry) => pushSettingsAllowType(entry.settings, "achievement_unlocked"));

  console.info(
    "[PUSH_NOTIFICATION_DEBUG]",
    JSON.stringify({
      kind: "achievement_unlocked",
      familyId: input.familyId,
      uid: input.uid,
      totalRecipients: recipients.length,
      totalDevices: deviceRecipients.length,
    }),
  );

  await sendToAllTransports({
    familyId: input.familyId,
    idToken: input.idToken,
    recipients,
    devices: deviceRecipients,
    payload: {
      title: input.title,
      body: input.body,
      url: pushNotificationTargetUrl("achievement_unlocked"),
      tag: "family-chores-achievement_unlocked",
    },
  });
}

export async function sendPushTestNotificationToUid(input: {
  familyId: string;
  idToken: string;
  uid: string;
  title: string;
  body: string;
}) {
  const { subscriptions, devices } = await loadPushRegistrations(input.familyId, input.idToken);

  const recipients = subscriptions.filter((entry) => entry.uid === input.uid);
  const deviceRecipients = devices.filter((entry) => entry.uid === input.uid);

  console.info(
    "[PUSH_NOTIFICATION_DEBUG]",
    JSON.stringify({
      kind: "test",
      familyId: input.familyId,
      uid: input.uid,
      totalRecipients: recipients.length,
      totalDevices: deviceRecipients.length,
    }),
  );

  await sendToAllTransports({
    familyId: input.familyId,
    idToken: input.idToken,
    recipients,
    devices: deviceRecipients,
    payload: {
      title: input.title,
      body: input.body,
      url: "/profile",
      tag: "family-chores-test",
    },
  });

  return { recipientCount: recipients.length + deviceRecipients.length };
}
