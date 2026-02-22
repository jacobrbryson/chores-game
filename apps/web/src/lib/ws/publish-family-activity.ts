type FamilyActivityEvent = {
  type: "chore_completed" | "chore_created" | "chore_updated" | "chore_deleted";
  familyId: string;
  choreId?: string;
  occurredAt?: string;
};

export async function publishFamilyActivity(event: FamilyActivityEvent) {
  const isProduction = process.env.NODE_ENV === "production";
  const wsServerUrl = (process.env.WS_SERVER_URL ?? process.env.NEXT_PUBLIC_WS_URL ?? "").trim();
  const secret = (
    process.env.WS_INTERNAL_SECRET ?? (isProduction ? "" : "dev-ws-internal-secret")
  ).trim();
  if (!wsServerUrl || !secret) {
    return;
  }

  try {
    await fetch(`${wsServerUrl.replace(/\/$/, "")}/events/family-activity`, {
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
  } catch {
    // Notification is best-effort and must not break chore workflows.
  }
}
