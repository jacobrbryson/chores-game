import type { AchievementResponseItem } from "@/lib/achievements/service";

export type AchievementsApiResponse = {
  kind: "ok" | "no_family";
  viewerRole: "admin" | "player";
  viewerUid: string;
  familyId: string;
  wsAuthToken: string;
  achievements: AchievementResponseItem[];
};

export async function fetchAchievements(signal?: AbortSignal) {
  const response = await fetch("/api/achievements", {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `ACHIEVEMENTS_HTTP_${response.status}`);
  }
  return (await response.json()) as AchievementsApiResponse;
}

export function readAchievementHighlightId(searchValue: string, hashValue: string) {
  const params = new URLSearchParams(searchValue);
  const queryId = (params.get("highlight") ?? "").trim();
  if (queryId) {
    return queryId;
  }
  return hashValue.replace(/^#/, "").trim();
}
