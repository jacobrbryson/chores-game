import type { TailwindSelectOption } from "@/components/tailwind-select";
import type { GoogleTasksProfileSummary } from "@/components/profile/profile-page.types";

export type DerivedGoogleTasksView = {
  googleTasksLinked: boolean;
  googleTaskListsLength: number;
  selectedGoogleTaskListIds: string[];
  selectedGoogleTaskListSummary: string;
  googleTaskListOptions: TailwindSelectOption<string>[];
  googleTasksLastSyncedLabel: string;
  googleTasksStatusLabel: string;
};

export function deriveGoogleTasksView(
  summary: GoogleTasksProfileSummary | null,
  formatDateTime: (value?: string) => string,
): DerivedGoogleTasksView {
  const googleTasksLinked = summary?.linked === true;
  const googleTaskLists = summary?.taskLists ?? [];
  const selectedGoogleTaskListIds =
    summary?.selectedTaskListIds && summary.selectedTaskListIds.length > 0
      ? summary.selectedTaskListIds
      : summary?.selectedTaskListId
        ? [summary.selectedTaskListId]
        : [];

  const selectedGoogleTaskListTitles =
    summary?.selectedTaskListTitles && summary.selectedTaskListTitles.length > 0
      ? summary.selectedTaskListTitles
      : summary?.selectedTaskListTitle
        ? [summary.selectedTaskListTitle]
        : selectedGoogleTaskListIds
            .map((id) => googleTaskLists.find((taskList) => taskList.id === id)?.title ?? "")
            .filter((title) => title.length > 0);

  const googleTaskListOptions: TailwindSelectOption<string>[] = googleTaskLists.map((taskList) => ({
    value: taskList.id,
    label: `${taskList.title}${taskList.isDefault ? " (default)" : ""}`,
  }));

  const googleTasksStatusLabel =
    summary?.lastSyncStatus === "ok"
      ? "Healthy"
      : summary?.lastSyncStatus === "error"
        ? "Needs attention"
        : "Not synced yet";

  return {
    googleTasksLinked,
    googleTaskListsLength: googleTaskLists.length,
    selectedGoogleTaskListIds,
    selectedGoogleTaskListSummary:
      selectedGoogleTaskListTitles.length > 0 ? selectedGoogleTaskListTitles.join(", ") : "No task lists selected",
    googleTaskListOptions,
    googleTasksLastSyncedLabel: formatDateTime(summary?.lastSyncedAt),
    googleTasksStatusLabel,
  };
}
