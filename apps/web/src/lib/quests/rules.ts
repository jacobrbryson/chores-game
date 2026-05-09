import { promises as fs } from "node:fs";
import path from "node:path";

export type QuestRulesRange = { min: number; max: number };

export type QuestRulesItemModel = {
  id: string;
  name: string;
  description: string;
  category: string;
  isPurchasable: boolean;
  coinCost: number;
  isUnlockable: boolean;
  isQuestPickup: boolean;
  canBeUsedInDecisions: boolean;
  usageTags: string[];
};

export type QuestRulesDefinition = {
  version: string;
  questRules: {
    durationMinutes: QuestRulesRange;
    pageRules: {
      sentencesPerPage: QuestRulesRange;
      decisionSpacingPages: QuestRulesRange;
    };
    purchaseRules: {
      questsAreCoinSinks: boolean;
      mostDecisionPathsRequireNoPurchase: boolean;
      maxRequiredStoreItemsPerDecision: number;
      avoidRequiredPurchasesOnMostPaths: boolean;
    };
  };
  validationRules: {
    validateDuration: boolean;
    validatePageSentenceCounts: boolean;
    validateDecisionSpacing: boolean;
    validateUnreachablePages: boolean;
    validateMissingImages: boolean;
    validateMissingAudio: boolean;
    validateUnknownItemReferences: boolean;
    validateUnknownCharacterReferences: boolean;
    validateUnknownThemeReferences: boolean;
    validateRequiredPurchaseLimits: boolean;
    validateEndingsHaveResolutionText: boolean;
  };
  catalogs: {
    storeItems: QuestRulesItemModel[];
    questItems: QuestRulesItemModel[];
    unlockableItems: QuestRulesItemModel[];
    characters: string[];
    themes: string[];
  };
};

const RULES_JSON_PATH = path.join(process.cwd(), "public", "quests", "rules.json");

let rulesCache: QuestRulesDefinition | null = null;

export async function getQuestRules(options?: { forceReload?: boolean }) {
  if (!options?.forceReload && rulesCache) {
    return rulesCache;
  }
  const raw = await fs.readFile(RULES_JSON_PATH, "utf8");
  const parsed = JSON.parse(raw) as QuestRulesDefinition;
  rulesCache = parsed;
  return parsed;
}
