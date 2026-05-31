import React, { useEffect, useState } from "react";
import {
  chooseMobileQuestPath,
  fetchMobileQuestState,
  fetchMobileQuests,
  replayMobileQuest,
  startMobileQuest,
  type MobileQuestState,
} from "@/lib/api";
import { AppScreen } from "@/components/ui";
import { MobileQuestLibrary, type MobileQuestLibraryState } from "@/components/MobileQuestLibrary";
import { MobileQuestReader, type MobileQuestReaderState } from "@/components/MobileQuestReader";
import { useMobileLocale } from "@/lib/locale";

type Props = {
  right?: React.ReactNode;
  onGoDashboard?: () => void;
};

export function QuestsScreen({ right, onGoDashboard }: Props) {
  const { t } = useMobileLocale();
  const [library, setLibrary] = useState<MobileQuestLibraryState>({ loading: true, items: [], hasUnlockedQuestPack: false });
  const [selectedQuestId, setSelectedQuestId] = useState("");
  const [reader, setReader] = useState<MobileQuestReaderState>(() => emptyReaderState());
  const [isStarting, setIsStarting] = useState(false);
  const [pendingChoiceId, setPendingChoiceId] = useState("");
  const [isReplaying, setIsReplaying] = useState(false);

  useEffect(() => {
    void loadLibrary();
  }, []);

  async function loadLibrary() {
    setLibrary((current) => ({ ...current, loading: true, error: undefined }));
    try {
      const payload = await fetchMobileQuests();
      setLibrary({ loading: false, items: payload.items, hasUnlockedQuestPack: payload.hasUnlockedQuestPack });
    } catch (err: unknown) {
      setLibrary({
        loading: false,
        error: err instanceof Error ? err.message : "quests_unavailable",
        items: [],
        hasUnlockedQuestPack: false,
      });
    }
  }

  async function openQuest(questId: string) {
    setSelectedQuestId(questId);
    setReader({ ...emptyReaderState(), loading: true });
    try {
      setReader(toReaderState(await fetchMobileQuestState(questId)));
    } catch (err: unknown) {
      setReader({
        ...emptyReaderState(),
        loading: false,
        error: err instanceof Error ? err.message : "quest_load_failed",
      });
    }
  }

  async function startQuest() {
    if (!selectedQuestId) {
      return;
    }
    setIsStarting(true);
    setReader((current) => ({ ...current, error: undefined, lastEnding: null, lastTransaction: null }));
    try {
      const payload = await startMobileQuest(selectedQuestId);
      setReader((current) => ({
        ...current,
        loading: false,
        progress: payload.progress,
        walletBalance: payload.walletBalance,
        currentNode: payload.currentNode,
      }));
      void loadLibrary();
    } catch (err: unknown) {
      setReader((current) => ({ ...current, error: err instanceof Error ? err.message : "quest_start_failed" }));
    } finally {
      setIsStarting(false);
    }
  }

  async function choosePath(choiceId: string) {
    if (!selectedQuestId || pendingChoiceId) {
      return;
    }
    setPendingChoiceId(choiceId);
    setReader((current) => ({ ...current, error: undefined }));
    try {
      const payload = await chooseMobileQuestPath(selectedQuestId, choiceId);
      setReader((current) => ({
        ...current,
        loading: false,
        progress: payload.progress,
        walletBalance: payload.walletBalance,
        currentNode: payload.currentNode,
        lastEnding: payload.ending,
        lastTransaction: payload.transaction,
      }));
      void loadLibrary();
    } catch (err: unknown) {
      setReader((current) => ({ ...current, error: err instanceof Error ? err.message : "quest_choice_failed" }));
    } finally {
      setPendingChoiceId("");
    }
  }

  async function replayQuest() {
    if (!selectedQuestId || isReplaying) {
      return;
    }
    setIsReplaying(true);
    setReader((current) => ({ ...current, error: undefined }));
    try {
      await replayMobileQuest(selectedQuestId);
      await startQuest();
    } catch (err: unknown) {
      setReader((current) => ({ ...current, error: err instanceof Error ? err.message : "quest_replay_failed" }));
    } finally {
      setIsReplaying(false);
    }
  }

  return (
    <AppScreen
      title={t("nav.quests")}
      subtitle={selectedQuestId ? t("quests.startPrompt") : t("quests.questLibrary")}
      right={right}
      onPressBreadcrumbRoot={onGoDashboard}>
      {selectedQuestId ? (
        <MobileQuestReader
          state={reader}
          isStarting={isStarting}
          pendingChoiceId={pendingChoiceId}
          isReplaying={isReplaying}
          onBack={() => {
            setSelectedQuestId("");
            setReader(emptyReaderState());
          }}
          onStart={startQuest}
          onChoose={choosePath}
          onReplay={replayQuest}
        />
      ) : (
        <MobileQuestLibrary state={library} onRefresh={loadLibrary} onOpenQuest={openQuest} />
      )}
    </AppScreen>
  );
}

function emptyReaderState(): MobileQuestReaderState {
  return {
    loading: false,
    questTitle: "",
    progress: null,
    walletBalance: 0,
    currentNode: null,
    totalEndings: 0,
    lastEnding: null,
    lastTransaction: null,
  };
}

function toReaderState(payload: MobileQuestState): MobileQuestReaderState {
  return {
    loading: false,
    questTitle: payload.quest?.title ?? "",
    progress: payload.progress,
    walletBalance: payload.walletBalance,
    currentNode: payload.currentNode,
    totalEndings: payload.quest?.meta?.totalEndings ?? 0,
    lastEnding: null,
    lastTransaction: null,
  };
}
