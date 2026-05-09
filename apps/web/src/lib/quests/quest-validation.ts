import { GAME_ITEM_BY_ID } from "@/lib/items/catalog";
import { STORE_CATEGORIES } from "@/lib/store/catalog";
import type { QuestRulesDefinition } from "@/lib/quests/rules";
import type { QuestDefinition } from "@/lib/quests/types";

function splitSentences(input: string) {
  return input
    .split(/[.!?]+/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

function getReachableNodeIds(quest: QuestDefinition) {
  const reachable = new Set<string>();
  const stack: string[] = [quest.startNodeId];
  const nodesById = new Map(quest.nodes.map((node) => [node.id, node]));
  while (stack.length > 0) {
    const nextId = stack.pop() as string;
    if (!nextId || reachable.has(nextId)) {
      continue;
    }
    reachable.add(nextId);
    const node = nodesById.get(nextId);
    if (!node || node.type !== "story") {
      continue;
    }
    for (const choice of node.choices) {
      stack.push(choice.nextNodeId);
    }
  }
  return reachable;
}

function getDecisionNodeIds(quest: QuestDefinition) {
  return new Set(
    quest.nodes
      .filter((node) => node.type === "story" && node.choices.length > 1)
      .map((node) => node.id),
  );
}

function minPagesToNextDecision(quest: QuestDefinition, fromNodeId: string, decisionNodeIds: Set<string>) {
  const queue: Array<{ nodeId: string; pages: number }> = [{ nodeId: fromNodeId, pages: 0 }];
  const visited = new Set<string>([fromNodeId]);
  const nodesById = new Map(quest.nodes.map((node) => [node.id, node]));
  while (queue.length > 0) {
    const next = queue.shift() as { nodeId: string; pages: number };
    const node = nodesById.get(next.nodeId);
    if (!node || node.type !== "story") {
      continue;
    }
    for (const choice of node.choices) {
      const target = nodesById.get(choice.nextNodeId);
      if (!target || target.type !== "story") {
        continue;
      }
      const pages = next.pages + 1;
      if (decisionNodeIds.has(target.id)) {
        return pages;
      }
      if (!visited.has(target.id)) {
        visited.add(target.id);
        queue.push({ nodeId: target.id, pages });
      }
    }
  }
  return null;
}

function buildKnownThemeSet(rules: QuestRulesDefinition) {
  return new Set((rules.catalogs.themes ?? []).map((theme) => theme.trim().toLowerCase()).filter(Boolean));
}

function buildKnownCharacterSet(rules: QuestRulesDefinition) {
  return new Set((rules.catalogs.characters ?? []).map((entry) => entry.trim()).filter(Boolean));
}

function buildKnownItemSet(rules: QuestRulesDefinition) {
  const known = new Set<string>();
  for (const item of [...rules.catalogs.storeItems, ...rules.catalogs.questItems, ...rules.catalogs.unlockableItems]) {
    if (item.id?.trim()) {
      known.add(item.id.trim());
    }
  }
  for (const itemId of GAME_ITEM_BY_ID.keys()) {
    known.add(itemId);
  }
  for (const category of STORE_CATEGORIES) {
    for (const option of category.options) {
      if (option.itemId?.trim()) {
        known.add(option.itemId.trim());
      }
      if (category.kind === "avatar") {
        known.add(option.id);
      }
    }
  }
  return known;
}

export function validateQuestAgainstRules(quest: QuestDefinition, rules: QuestRulesDefinition) {
  const issues: string[] = [];
  const v = rules.validationRules;
  if (v.validateDuration) {
    const { min, max } = rules.questRules.durationMinutes;
    if (quest.estimatedMinutes < min || quest.estimatedMinutes > max) {
      issues.push(`estimatedMinutes ${quest.estimatedMinutes} outside [${min}, ${max}]`);
    }
  }

  const storyNodes = quest.nodes.filter((node) => node.type === "story");
  if (v.validatePageSentenceCounts) {
    const { min, max } = rules.questRules.pageRules.sentencesPerPage;
    for (const node of storyNodes) {
      const sentenceCount = splitSentences(node.text).length;
      if (sentenceCount < min || sentenceCount > max) {
        issues.push(`node ${node.id} has ${sentenceCount} sentences outside [${min}, ${max}]`);
      }
    }
  }

  if (v.validateDecisionSpacing) {
    const { min, max } = rules.questRules.pageRules.decisionSpacingPages;
    const decisionNodeIds = getDecisionNodeIds(quest);
    for (const nodeId of decisionNodeIds) {
      const spacing = minPagesToNextDecision(quest, nodeId, decisionNodeIds);
      if (spacing === null) {
        continue;
      }
      if (spacing < min || spacing > max) {
        issues.push(`decision spacing from ${nodeId} is ${spacing} pages outside [${min}, ${max}]`);
      }
    }
  }

  const knownItems = buildKnownItemSet(rules);
  if (v.validateUnknownItemReferences) {
    for (const node of storyNodes) {
      for (const choice of node.choices) {
        const itemId = choice.requiredItemId?.trim();
        if (!itemId) {
          continue;
        }
        if (!knownItems.has(itemId)) {
          issues.push(`node ${node.id} choice ${choice.id} references unknown item ${itemId}`);
        }
      }
    }
    const rewardItemIds = new Set<string>();
    for (const node of quest.nodes) {
      if (node.type !== "ending") {
        continue;
      }
      for (const itemId of node.ending.rewards.items) {
        rewardItemIds.add(itemId);
      }
    }
    for (const itemId of quest.globalRewards?.firstCompletion?.items ?? []) {
      rewardItemIds.add(itemId);
    }
    for (const itemId of quest.globalRewards?.allEndingsDiscovered?.items ?? []) {
      rewardItemIds.add(itemId);
    }
    for (const itemId of rewardItemIds) {
      if (!knownItems.has(itemId)) {
        issues.push(`reward references unknown item ${itemId}`);
      }
    }
  }

  if (v.validateUnknownThemeReferences) {
    const knownThemes = buildKnownThemeSet(rules);
    for (const theme of quest.themes) {
      if (!knownThemes.has(theme.trim().toLowerCase())) {
        issues.push(`quest theme "${theme}" is not in rules catalogs.themes`);
      }
    }
  }

  if (v.validateUnknownCharacterReferences) {
    const knownCharacters = buildKnownCharacterSet(rules);
    for (const itemId of quest.globalRewards?.firstCompletion?.items ?? []) {
      if (itemId.startsWith("character_") && !knownCharacters.has(itemId)) {
        issues.push(`firstCompletion reward character ${itemId} not in catalogs.characters`);
      }
    }
  }

  if (v.validateRequiredPurchaseLimits) {
    const maxRequired = rules.questRules.purchaseRules.maxRequiredStoreItemsPerDecision;
    for (const node of storyNodes) {
      for (const choice of node.choices) {
        const requiresPurchase = Boolean(choice.requiredItemId?.trim()) && choice.purchaseBehavior.allowPurchaseIfMissing;
        if (requiresPurchase && maxRequired < 1) {
          issues.push(`node ${node.id} choice ${choice.id} violates required purchase limit`);
        }
      }
    }
  }

  if (v.validateUnreachablePages) {
    const reachable = getReachableNodeIds(quest);
    for (const node of quest.nodes) {
      if (!reachable.has(node.id)) {
        issues.push(`node ${node.id} is unreachable from start node ${quest.startNodeId}`);
      }
    }
  }

  if (v.validateEndingsHaveResolutionText) {
    for (const node of quest.nodes) {
      if (node.type !== "ending") {
        continue;
      }
      if (!node.text.trim()) {
        issues.push(`ending ${node.id} is missing resolution text`);
      }
    }
  }

  return issues;
}
