import type { Metadata } from "next";
import { FamilyQuestEditorClient } from "@/components/family-quest-editor-client";

export const metadata: Metadata = {
  title: "Edit Family Quest | Family Chores",
};

export default async function EditFamilyQuestPage({
  params,
}: {
  params: Promise<{ questId: string }>;
}) {
  const { questId } = await params;
  return <FamilyQuestEditorClient questId={questId} />;
}
