const PUSH_SERVICE_WORKER_PATH = "/push-sw.js";

export function browserSupportsPushNotifications() {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

function base64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const normalized = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalized);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

export async function registerPushServiceWorker() {
  return navigator.serviceWorker.register(PUSH_SERVICE_WORKER_PATH);
}

export async function getRegisteredPushServiceWorker() {
  return navigator.serviceWorker.getRegistration(PUSH_SERVICE_WORKER_PATH);
}

export async function getCurrentBrowserPushSubscription() {
  const registration = await registerPushServiceWorker();
  return registration.pushManager.getSubscription();
}

export async function ensureBrowserPushSubscription(publicKey: string) {
  const registration = await registerPushServiceWorker();
  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    return existing;
  }
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64ToUint8Array(publicKey),
  });
}
