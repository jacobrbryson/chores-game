import type { AchievementUnlockedEvent } from "@/lib/ws/achievement-unlocked-event";

const ACHIEVEMENT_PUBLISH_TIMEOUT_MS = 1800;
const MAX_ERROR_BODY_LOG_CHARS = 280;

export async function publishAchievementUnlocked(event: AchievementUnlockedEvent) {
  const isProduction = process.env.NODE_ENV === "production";
  const wsServerUrl = (process.env.NEXT_PUBLIC_WS_URL ?? "").trim();
  const secret = (
    process.env.WS_INTERNAL_SECRET ?? (isProduction ? "" : "dev-ws-internal-secret")
  ).trim();
  if (!wsServerUrl || !secret) {
    console.warn("achievement publish skipped due to missing ws config", {
      hasWsServerUrl: Boolean(wsServerUrl),
      hasInternalSecret: Boolean(secret),
    });
    return;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ACHIEVEMENT_PUBLISH_TIMEOUT_MS);
    const response = await fetch(`${wsServerUrl.replace(/\/$/, "")}/events/achievement-unlocked`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(event),
      cache: "no-store",
      signal: controller.signal,
    }).finally(() => {
      clearTimeout(timeout);
    });
    if (!response.ok) {
      const body = (await response.text()).slice(0, MAX_ERROR_BODY_LOG_CHARS);
      console.warn("achievement publish failed", {
        status: response.status,
        body,
      });
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.warn("achievement publish timed out", {
        timeoutMs: ACHIEVEMENT_PUBLISH_TIMEOUT_MS,
      });
      return;
    }
    console.warn("achievement publish request threw before response");
  }
}
