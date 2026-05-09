import type { Metadata } from "next";
import { Alert } from "@/components/alert";
import { BackLink } from "@/components/back-link";
import { QuestReaderClient } from "@/app/features/quests/quest-reader-client";
import { getQuestDefinitionById } from "@/lib/quests/service";

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
  const quest = await getQuestDefinitionById(questId);
  const questHeading = quest?.title?.trim() || "Quest Reader";
  const isComingSoonQuest =
    questId === "template-quest-002" ||
    questId === "template-quest-003" ||
    questId === "template-quest-004" ||
    questId === "template-quest-005" ||
    questId === "template-quest-006";

  return (
    <main className="panel family-page quest-page quests-netflix-page">
      <div className="page-header-row">
        <div className="page-header-inline">
          <BackLink className="page-back-link" fallbackHref="/quests" />
          <h1>{questHeading}</h1>
        </div>
      </div>
      {isComingSoonQuest ? (
        <Alert tone="info">Coming Soon! This quest is not playable yet.</Alert>
      ) : (
        <QuestReaderClient questId={questId} />
      )}
    </main>
  );
}
