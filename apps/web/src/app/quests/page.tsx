import type { Metadata } from "next";
import { BackLink } from "@/components/back-link";
import { Alert } from "@/components/alert";
import { QuestsLibraryClient } from "@/app/features/quests/quests-library-client";

export const metadata: Metadata = {
  title: "Quests | Family Chores",
  description: "Interactive choose-your-own-adventure quest library.",
};

export default function QuestsPage() {
  return (
    <main className="panel family-page quests-coming-soon-page quests-netflix-page">
      <div className="page-header-row">
        <div className="page-header-inline">
          <BackLink className="page-back-link" fallbackHref="/" />
          <h1>Quests</h1>
        </div>
      </div>
      <div className="quests-coming-soon-content-wrap">
        <Alert tone="info" align="center" showIcon={false} className="quests-coming-soon-intro-alert">
          <div className="small">
            <p>
              Choose your next adventure. Start with the featured quest, then unlock the full quest pack.
            </p>
          </div>
        </Alert>
        <QuestsLibraryClient />
      </div>
    </main>
  );
}
