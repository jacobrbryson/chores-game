import { promises as fs } from "node:fs";
import path from "node:path";
import { validateQuestAgainstRules } from "@/lib/quests/quest-validation";
import {
  getFamilyQuestDefinition,
  listPublishedFamilyQuestDefinitions,
} from "@/lib/quests/family-quests";
import { getPrimaryFamilyIdWithFallback } from "@/lib/family/member-access";
import { getQuestRules } from "@/lib/quests/rules";
import { validateQuestDefinition } from "@/lib/quests/validation";
import type { QuestDefinition } from "@/lib/quests/types";

const QUEST_JSON_DIRECTORY = path.join(process.cwd(), "src", "assets", "quests");

type QuestCacheState = {
  loadedAt: number;
  quests: QuestDefinition[];
};

let questCache: QuestCacheState | null = null;

async function readQuestFiles(): Promise<QuestDefinition[]> {
  const rules = await getQuestRules();
  const isDev = process.env.NODE_ENV !== "production";
  const entries = await fs.readdir(QUEST_JSON_DIRECTORY, { withFileTypes: true });
  const questFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const quests: QuestDefinition[] = [];
  for (const fileName of questFiles) {
    const filePath = path.join(QUEST_JSON_DIRECTORY, fileName);
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const quest = validateQuestDefinition(parsed);
    if (isDev) {
      const issues = validateQuestAgainstRules(quest, rules);
      if (issues.length > 0) {
        for (const issue of issues) {
          console.warn(`[QUEST_RULES_VALIDATION][${quest.id}] ${issue}`);
        }
      }
    }
    quests.push(quest);
  }
  return quests;
}

export async function listQuestDefinitions(options?: { forceReload?: boolean }) {
  const isDev = process.env.NODE_ENV !== "production";
  if (isDev) {
    return readQuestFiles();
  }
  if (!options?.forceReload && questCache) {
    return questCache.quests;
  }
  const quests = await readQuestFiles();
  questCache = {
    loadedAt: Date.now(),
    quests,
  };
  return quests;
}

export async function getQuestDefinitionById(questId: string) {
  const quests = await listQuestDefinitions();
  return quests.find((quest) => quest.id === questId) ?? null;
}

export async function listQuestDefinitionsForViewer(input: {
  uid: string;
  email: string;
  idToken: string;
}) {
  const baseQuests = await listQuestDefinitions();
  const familyId = await getPrimaryFamilyIdWithFallback(input.uid, input.email, input.idToken);
  if (!familyId) {
    return baseQuests;
  }
  const familyQuests = await listPublishedFamilyQuestDefinitions(familyId, input.idToken);
  const seen = new Set(baseQuests.map((quest) => quest.id));
  return [...baseQuests, ...familyQuests.filter((quest) => !seen.has(quest.id))];
}

export async function getQuestDefinitionForViewer(input: {
  questId: string;
  uid: string;
  email: string;
  idToken: string;
}) {
  const builtInQuest = await getQuestDefinitionById(input.questId);
  if (builtInQuest) {
    return builtInQuest;
  }

  const familyId = await getPrimaryFamilyIdWithFallback(input.uid, input.email, input.idToken);
  if (!familyId) {
    return null;
  }
  return getFamilyQuestDefinition(familyId, input.questId, input.idToken, "published");
}

export function getQuestNodeById(quest: QuestDefinition, nodeId: string) {
  return quest.nodes.find((node) => node.id === nodeId) ?? null;
}
