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
    <main className="panel family-page">
      <div className="page-header-row">
        <div className="page-header-inline">
          <BackLink className="page-back-link" fallbackHref="/" />
          <h1>Quests</h1>
        </div>
      </div>
      <Alert tone="info" align="center" showIcon={false} className="mb-4">
        <div className="small">
          <p>
            Quests are interactive choose-your-own-adventure stories. Players use inventory items to unlock choices,
            discover different endings, and earn coins, items, achievements, and collectibles.
          </p>
          <ul className="mt-2 list-disc pl-5">
            <li>Some choices require quest items.</li>
            <li>If missing and purchasable, items can be bought and used immediately from inside the quest.</li>
            <li>Different paths lead to different endings.</li>
            <li>Replay to discover alternate endings and extra rewards.</li>
          </ul>
        </div>
      </Alert>
      <QuestsLibraryClient />
    </main>
  );
}
