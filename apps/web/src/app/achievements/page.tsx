import type { Metadata } from "next";
import { AchievementsPageClient } from "@/components/achievements/achievements-page-client";
import { DiscoverySeenOnMount } from "@/components/discovery-seen-on-mount";

export const metadata: Metadata = {
  title: "Achievements | Family Chores",
  description: "Track chore game progress and unlock achievements.",
};

export default function AchievementsPage() {
  return (
    <main className="family-page">
      <DiscoverySeenOnMount sections={["achievements"]} />
      <AchievementsPageClient />
    </main>
  );
}
