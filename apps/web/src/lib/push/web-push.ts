import webpush from "web-push";

let vapidConfigured = false;

export function getPushPublicKey() {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? "";
}

function getPushPrivateKey() {
  return process.env.VAPID_PRIVATE_KEY?.trim() ?? "";
}

function getPushSubject() {
  return process.env.VAPID_SUBJECT?.trim() || "mailto:support@example.com";
}

export function isWebPushConfigured() {
  return Boolean(getPushPublicKey() && getPushPrivateKey());
}

function ensureWebPushConfigured() {
  if (vapidConfigured) {
    return;
  }
  const publicKey = getPushPublicKey();
  const privateKey = getPushPrivateKey();
  if (!publicKey || !privateKey) {
    throw new Error("WEB_PUSH_CONFIG_MISSING");
  }
  webpush.setVapidDetails(getPushSubject(), publicKey, privateKey);
  vapidConfigured = true;
}

export async function sendWebPushNotification(
  subscription: PushSubscriptionJSON,
  payload: Record<string, unknown>,
) {
  ensureWebPushConfigured();
  await webpush.sendNotification(
    subscription as webpush.PushSubscription,
    JSON.stringify(payload),
  );
}
