export type QuestDifficulty = "easy" | "medium" | "hard";

export type QuestRank = "best" | "great" | "good" | "silly";

export type QuestChoicePurchaseBehavior = {
  allowPurchaseIfMissing: boolean;
  purchaseAndUseImmediately: boolean;
};

export type QuestLocalizedTextMap = Record<string, string>;

export type QuestLocalizedChoiceContent = {
  label?: string;
  description?: string;
  requiredItemName?: string;
  unavailableText?: string;
};

export type QuestLocalizedEndingContent = {
  replayHint?: string;
  rewardSummary?: string;
};

export type QuestLocalizedNodeContent = {
  title?: string;
  text?: string;
  imageAlt?: string;
  imageCaption?: string;
  audioTitle?: string;
  choices?: Record<string, QuestLocalizedChoiceContent>;
  ending?: QuestLocalizedEndingContent;
};

export type QuestLocalizedContent = {
  title?: string;
  subtitle?: string;
  summary?: string;
  author?: string;
  ageRange?: string;
  coverImageAlt?: string;
  nodes?: Record<string, QuestLocalizedNodeContent>;
};

export type QuestChoice = {
  id: string;
  label: string;
  description: string;
  requiredItemId?: string;
  requiredItemName?: string;
  requiredItemImage?: string;
  consumeItem: boolean;
  purchaseBehavior: QuestChoicePurchaseBehavior;
  nextNodeId: string;
  unavailableText?: string;
};

export type QuestRewardSet = {
  coins: number;
  items: string[];
  achievements: string[];
};

export type QuestStoryNode = {
  id: string;
  type: "story";
  title: string;
  image?: string;
  imageAlt?: string;
  imageCaption?: string;
  audio?: string;
  audioTitle?: string;
  text: string;
  choices: QuestChoice[];
};

export type QuestEndingNode = {
  id: string;
  type: "ending";
  title: string;
  image?: string;
  imageAlt?: string;
  imageCaption?: string;
  audio?: string;
  audioTitle?: string;
  text: string;
  ending: {
    endingId: string;
    rank: QuestRank;
    stars: number;
    replayHint?: string;
    rewardSummary: string;
    rewards: QuestRewardSet;
  };
};

export type QuestNode = QuestStoryNode | QuestEndingNode;

export type QuestMeta = {
  totalNodes: number;
  totalEndings: number;
  replayEnabled: boolean;
};

export type QuestDefinition = {
  id: string;
  slug: string;
  defaultLocale: string;
  availableLocales?: string[];
  title: string;
  subtitle: string;
  author: string;
  illustrator?: string;
  narrator?: string;
  publisher?: string;
  copyright?: string;
  version: string;
  difficulty: QuestDifficulty;
  coverImage?: string;
  coverImageAlt?: string;
  summary: string;
  ageRange: string;
  readingLevel?: string;
  estimatedMinutes: number;
  themes: string[];
  contentWarnings: string[];
  tags: string[];
  meta: QuestMeta;
  credits?: {
    story?: string;
    artDirection?: string;
    audio?: string;
    notes?: string;
  };
  startNodeId: string;
  globalRewards?: {
    firstCompletion?: QuestRewardSet;
    allEndingsDiscovered?: QuestRewardSet;
  };
  locales?: Record<string, QuestLocalizedContent>;
  nodes: QuestNode[];
};

export type QuestStatus = "not_started" | "in_progress" | "completed";

export type QuestChoiceRecord = {
  choiceId: string;
  fromNodeId: string;
  toNodeId: string;
  usedItemId: string;
  purchasedBeforeUse: boolean;
  consumedItem: boolean;
  createdAt: string;
};

export type QuestProgress = {
  userId: string;
  questId: string;
  currentNodeId: string;
  status: QuestStatus;
  choicesMade: QuestChoiceRecord[];
  endingsReached: string[];
  bestEndingId: string;
  timesPlayed: number;
  completedAt: string;
  lastPlayedAt: string;
  updatedAt: string;
  firstCompletionRewardGrantedAt?: string;
  allEndingsRewardGrantedAt?: string;
  endingRewardIdsGranted: string[];
};

export type QuestLibraryEntry = {
  questId: string;
  slug: string;
  title: string;
  subtitle: string;
  author: string;
  coverImage: string;
  summary: string;
  ageRange: string;
  estimatedMinutes: number;
  difficulty: QuestDifficulty;
  completionStatus: QuestStatus;
  endingsDiscovered: number;
  totalEndings: number;
  bestEndingId: string;
  actionLabel: "Start" | "Continue" | "Replay";
  progress: QuestProgress;
};
