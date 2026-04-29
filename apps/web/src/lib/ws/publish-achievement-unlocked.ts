import type { AchievementUnlockedEvent } from "@/lib/ws/achievement-unlocked-event";

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
    const response = await fetch(`${wsServerUrl.replace(/\/$/, "")}/events/achievement-unlocked`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(event),
      cache: "no-store",
    });
    if (!response.ok) {
      const body = await response.text();
      console.warn("achievement publish failed", {
        status: response.status,
        body,
      });
    }
  } catch {
    console.warn("achievement publish request threw before response");
  }
}
