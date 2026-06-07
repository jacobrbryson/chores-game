import type { Metadata } from "next";
import { FamilyQuestEditorClient } from "@/components/family-quest-editor-client";

export const metadata: Metadata = {
  title: "New Family Quest",
};

export default function NewFamilyQuestPage() {
  return <FamilyQuestEditorClient />;
}
