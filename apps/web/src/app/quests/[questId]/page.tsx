import type { Metadata } from "next";
import { BackLink } from "@/components/back-link";
import { QuestReaderClient } from "@/app/features/quests/quest-reader-client";

export const metadata: Metadata = {
  title: "Quest Reader | Family Chores",
  description: "Play interactive story quests.",
};

export default async function QuestReaderPage({
  params,
}: {
  params: Promise<{ questId: string }>;
}) {
  const { questId } = await params;

  return (
    <main className="panel family-page quest-page">
      <div className="page-header-row">
        <div className="page-header-inline">
          <BackLink className="page-back-link" fallbackHref="/quests" />
          <h1>Quest Reader</h1>
        </div>
      </div>
      <QuestReaderClient questId={questId} />
    </main>
  );
}
