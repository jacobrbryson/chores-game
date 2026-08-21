export async function postStoreAction(body: Record<string, unknown>, errorPrefix: string) {
  const response = await fetch("/api/store", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = (await response.json()) as { error?: string };
    throw new Error(payload.error ?? `${errorPrefix}_${response.status}`);
  }
}

export async function postGoogleTasksAction(body: Record<string, unknown>) {
  const response = await fetch("/api/google-tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = (await response.json()) as { error?: string };
    throw new Error(payload.error ?? `GOOGLE_TASKS_ACTION_HTTP_${response.status}`);
  }
}

export async function patchProfileAction(body: Record<string, unknown>) {
  const response = await fetch("/api/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as { error?: string; name?: string; locale?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? `PROFILE_ACTION_HTTP_${response.status}`);
  }
  return payload;
}

export async function getPushNotificationsSummary() {
  const response = await fetch("/api/push-notifications", { cache: "no-store" });
  const payload = (await response.json()) as {
    error?: string;
    configured?: boolean;
    permission?: "default" | "denied" | "granted";
    settings?: {
      choreCompleted?: boolean;
      rewardClaimed?: boolean;
      choreApprovalRequired?: boolean;
      achievementUnlocked?: boolean;
    };
    hasStoredSubscription?: boolean;
    subscriptionCount?: number;
    vapidPublicKey?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error ?? `PUSH_NOTIFICATIONS_HTTP_${response.status}`);
  }
  return {
    configured: payload.configured === true,
    permission: payload.permission ?? "default",
    settings: {
      choreCompleted: payload.settings?.choreCompleted === true,
      rewardClaimed: payload.settings?.rewardClaimed === true,
      choreApprovalRequired: payload.settings?.choreApprovalRequired === true,
      achievementUnlocked: payload.settings?.achievementUnlocked === true,
    },
    hasStoredSubscription: payload.hasStoredSubscription === true,
    subscriptionCount: Math.max(0, payload.subscriptionCount ?? 0),
    vapidPublicKey: payload.vapidPublicKey ?? "",
  };
}

export async function patchPushNotificationsAction(body: Record<string, unknown>) {
  const response = await fetch("/api/push-notifications", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? `PUSH_NOTIFICATIONS_PATCH_HTTP_${response.status}`);
  }
}

export async function postPushNotificationSample(body: Record<string, unknown>) {
  const response = await fetch("/api/push-notifications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as { error?: string; recipientCount?: number };
  if (!response.ok) {
    throw new Error(payload.error ?? `PUSH_NOTIFICATIONS_TEST_HTTP_${response.status}`);
  }
  return payload;
}
