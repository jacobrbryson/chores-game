import type { Metadata } from "next";
import { AchievementsPageClient } from "@/components/achievements/achievements-page-client";

export const metadata: Metadata = {
  title: "Achievements | Family Chores",
  description: "Track chore game progress and unlock achievements.",
};

export default function AchievementsPage() {
  return (
    <main className="family-page">
      <AchievementsPageClient />
    </main>
  );
}
