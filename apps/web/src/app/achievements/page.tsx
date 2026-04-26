import type { Metadata } from "next";
import { BackLink } from "@/components/back-link";

export const metadata: Metadata = {
  title: "Achievements | Family Chores",
  description: "Family achievement milestones and badges are coming soon.",
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
      <p className="family-page-subhead">
        Achievement badges and family milestones are on the way. Check back soon.
      </p>
    </main>
  );
}
