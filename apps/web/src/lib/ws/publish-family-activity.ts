import type { FamilyActivityType } from "@/lib/ws/family-activity-event";
import { listFamilyFriends } from "@/lib/family-friends/repository";

type FamilyActivityPublishEvent = {
  type: FamilyActivityType;
  familyId: string;
  choreId?: string;
  occurredAt?: string;
  // Kiosk Mode attribution so realtime consumers can distinguish a shared
  // tablet completion and tell who completed it for whom.
  source?: string;
  authenticatedUid?: string;
  completedForPlayerId?: string;
  // New Skill Bonus attribution for realtime celebration cues.
  newSkillBonusAwarded?: boolean;
  newSkillBonusAmount?: number;
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
    const friendRefreshTypes = new Set<FamilyActivityType>([
      "chore_completed",
      "chore_approved",
      "routine_completed",
      "reward_claimed",
      "identity_title_unlocked",
      "family_reward_created",
    ]);
    const friendFamilyIds = friendRefreshTypes.has(event.type)
      ? (await listFamilyFriends(event.familyId).catch(() => [])).map((friend) => friend.familyId)
      : [];
    await Promise.all(
      [event.familyId, ...friendFamilyIds].map(async (targetFamilyId) => {
        const response = await fetch(`${wsServerUrl.replace(/\/$/, "")}/events/family-activity`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${secret}`,
          },
          body: JSON.stringify({
            ...event,
            familyId: targetFamilyId,
            occurredAt: event.occurredAt ?? new Date().toISOString(),
          }),
          cache: "no-store",
        });
        if (!response.ok) {
          const body = await response.text();
          console.warn("publish failed", { status: response.status, body });
        }
      }),
    );
  } catch {
    // Notification is best-effort and must not break chore workflows.
    console.warn("publish request threw before response");
  }
}
