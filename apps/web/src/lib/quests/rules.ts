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
const GCS_ASSET_BASE_URL = process.env.NEXT_PUBLIC_GCS_ASSET_BASE_URL?.replace(/\/+$/, "");
const GCS_RULES_URL = GCS_ASSET_BASE_URL ? `${GCS_ASSET_BASE_URL}/quests/rules.json` : "";

let rulesCache: QuestRulesDefinition | null = null;

async function loadRulesJson() {
  if (GCS_RULES_URL) {
    const response = await fetch(GCS_RULES_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to fetch quest rules from ${GCS_RULES_URL}: ${response.status}`);
    }
    return response.text();
  }

  return fs.readFile(RULES_JSON_PATH, "utf8");
}

export async function getQuestRules(options?: { forceReload?: boolean }) {
  if (!options?.forceReload && rulesCache) {
    return rulesCache;
  }
  const raw = await loadRulesJson();
  const parsed = JSON.parse(raw) as QuestRulesDefinition;
  rulesCache = parsed;
  return parsed;
}
