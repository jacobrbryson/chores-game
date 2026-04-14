import { documentIdFromName, listDocuments } from "@/lib/firestore/rest";
import {
  pushNotificationTargetUrl,
  pushSettingsAllowType,
  type PushNotificationType,
} from "@/lib/push/constants";
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

type ResolvedPushRecipient = NonNullable<
  ReturnType<typeof readStoredPushSubscriptionRecord>
>;

async function listResolvedPushRecipients(familyId: string, idToken: string) {
  const docs = await listDocuments(`families/${familyId}/pushSubscriptions`, idToken, 300);
  return docs
    .map((doc) => readStoredPushSubscriptionRecord(documentIdFromName(doc.name), doc.fields))
    .flatMap((entry) => (entry ? [entry] : []));
}

async function sendPushPayload(
  recipients: ResolvedPushRecipient[],
  payload: { title: string; body: string; url: string; tag: string },
) {
  if (recipients.length === 0) {
    console.info("[PUSH_NOTIFICATION_DEBUG] no_recipients");
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

export async function sendFamilyPushNotifications(input: SendFamilyPushNotificationsInput) {
  if (!isWebPushConfigured()) {
    console.info("[PUSH_NOTIFICATION_DEBUG] web_push_not_configured");
    return;
  }

  const recipients = (await listResolvedPushRecipients(input.familyId, input.idToken))
    .filter((entry) => entry.uid !== input.actorUid)
    .filter((entry) => pushSettingsAllowType(entry.settings, input.type));

  console.info(
    "[PUSH_NOTIFICATION_DEBUG]",
    JSON.stringify({
      kind: input.type,
      familyId: input.familyId,
      totalRecipients: recipients.length,
    }),
  );

  await sendPushPayload(recipients, {
    title: input.title,
    body: input.body,
    url: pushNotificationTargetUrl(input.type),
    tag: `family-chores-${input.type}`,
  });
}

export async function sendPushTestNotificationToUid(input: {
  familyId: string;
  idToken: string;
  uid: string;
  title: string;
  body: string;
}) {
  if (!isWebPushConfigured()) {
    console.info("[PUSH_NOTIFICATION_DEBUG] web_push_not_configured");
    return { recipientCount: 0 };
  }

  const recipients = (await listResolvedPushRecipients(input.familyId, input.idToken)).filter(
    (entry) => entry.uid === input.uid,
  );

  console.info(
    "[PUSH_NOTIFICATION_DEBUG]",
    JSON.stringify({
      kind: "test",
      familyId: input.familyId,
      uid: input.uid,
      totalRecipients: recipients.length,
    }),
  );

  await sendPushPayload(recipients, {
    title: input.title,
    body: input.body,
    url: "/profile",
    tag: "family-chores-test",
  });

  return { recipientCount: recipients.length };
}
