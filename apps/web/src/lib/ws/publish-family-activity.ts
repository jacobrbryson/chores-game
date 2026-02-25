import type { FamilyActivityType } from "@/lib/ws/family-activity-event";

type FamilyActivityPublishEvent = {
  type: FamilyActivityType;
  familyId: string;
  choreId?: string;
  occurredAt?: string;
};

export async function publishFamilyActivity(event: FamilyActivityPublishEvent) {
  const isProduction = process.env.NODE_ENV === "production";
  const wsServerUrl = (process.env.NEXT_PUBLIC_WS_URL ?? "").trim();
  const secret = (
    process.env.WS_INTERNAL_SECRET ?? (isProduction ? "" : "dev-ws-internal-secret")
  ).trim();
  if (!wsServerUrl || !secret) {
    console.warn("publish skipped due to missing ws config", {
      hasWsServerUrl: Boolean(wsServerUrl),
      hasInternalSecret: Boolean(secret),
    });
    return;
  }

  try {
    const response = await fetch(`${wsServerUrl.replace(/\/$/, "")}/events/family-activity`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        ...event,
        occurredAt: event.occurredAt ?? new Date().toISOString(),
      }),
      cache: "no-store",
    });
    if (!response.ok) {
      const body = await response.text();
      console.warn("publish failed", {
        status: response.status,
        body,
      });
    }
  } catch {
    // Notification is best-effort and must not break chore workflows.
    console.warn("publish request threw before response");
  }
}
