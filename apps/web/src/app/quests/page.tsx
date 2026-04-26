import type { Metadata } from "next";
import { BackLink } from "@/components/back-link";

export const metadata: Metadata = {
  title: "Quests | Family Chores",
  description: "Family quests and long-form challenge tracks are coming soon.",
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
      <p className="family-page-subhead">
        Weekly and seasonal quest chains are in progress. Check back soon.
      </p>
    </main>
  );
}
