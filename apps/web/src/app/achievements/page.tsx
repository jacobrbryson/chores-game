import type { Metadata } from "next";
import { BackLink } from "@/components/back-link";
import { AchievementsPageClient } from "@/components/achievements/achievements-page-client";

export const metadata: Metadata = {
  title: "Achievements | Family Chores",
  description: "Track chore game progress and unlock achievements.",
};

export default function AchievementsPage() {
  return (
    <main className="panel family-page">
      <div className="page-header-row">
        <div className="page-header-inline">
          <BackLink className="page-back-link" fallbackHref="/" />
          <h1>Achievements</h1>
        </div>
      </div>
      <p className="family-page-subhead">Progress, unlocks, and milestones for your family journey.</p>
      <AchievementsPageClient />
    </main>
  );
}
