import type { QuestDefinition, QuestEndingNode, QuestNode, QuestStoryNode } from "@/lib/quests/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function validateStoryNode(node: QuestStoryNode, nodeIds: Set<string>) {
  assert(Array.isArray(node.choices), `QUEST_NODE_${node.id}_CHOICES_REQUIRED`);
  assert(node.choices.length >= 1 && node.choices.length <= 5, `QUEST_NODE_${node.id}_CHOICE_COUNT_INVALID`);
  const choiceIds = new Set<string>();
  for (const choice of node.choices) {
    assert(Boolean(choice.id), `QUEST_NODE_${node.id}_CHOICE_ID_REQUIRED`);
    assert(!choiceIds.has(choice.id), `QUEST_NODE_${node.id}_CHOICE_ID_DUPLICATE_${choice.id}`);
    choiceIds.add(choice.id);
    assert(Boolean(choice.nextNodeId), `QUEST_NODE_${node.id}_CHOICE_${choice.id}_NEXT_NODE_MISSING`);
    assert(nodeIds.has(choice.nextNodeId), `QUEST_NODE_${node.id}_CHOICE_${choice.id}_NEXT_NODE_INVALID_${choice.nextNodeId}`);
  }
}

function validateEndingNode(node: QuestEndingNode, endingIds: Set<string>) {
  assert(Boolean(node.ending?.endingId), `QUEST_ENDING_${node.id}_ENDING_ID_REQUIRED`);
  assert(!endingIds.has(node.ending.endingId), `QUEST_ENDING_ID_DUPLICATE_${node.ending.endingId}`);
  endingIds.add(node.ending.endingId);
}

function toQuestNode(node: unknown): QuestNode {
  const source = isRecord(node) ? node : {};
  const type = asString(source.type);
  const base = {
    id: asString(source.id),
    type,
    title: asString(source.title),
    image: asString(source.image),
    imageAlt: asString(source.imageAlt),
    imageCaption: asString(source.imageCaption),
    audio: asString(source.audio),
    audioTitle: asString(source.audioTitle),
    text: asString(source.text),
  };

  if (type === "story") {
    const choiceSource = Array.isArray(source.choices) ? source.choices : [];
    const choices = choiceSource
      .filter((entry): entry is Record<string, unknown> => isRecord(entry))
      .map((choice) => ({
        id: asString(choice.id),
        label: asString(choice.label),
        description: asString(choice.description),
        requiredItemId: asString(choice.requiredItemId),
        requiredItemName: asString(choice.requiredItemName),
        requiredItemImage: asString(choice.requiredItemImage),
        consumeItem: asBoolean(choice.consumeItem),
        purchaseBehavior: {
          allowPurchaseIfMissing: asBoolean(
            isRecord(choice.purchaseBehavior) ? choice.purchaseBehavior.allowPurchaseIfMissing : false,
          ),
          purchaseAndUseImmediately: asBoolean(
            isRecord(choice.purchaseBehavior) ? choice.purchaseBehavior.purchaseAndUseImmediately : false,
          ),
        },
        nextNodeId: asString(choice.nextNodeId),
        unavailableText: asString(choice.unavailableText),
      }));
    return {
      ...base,
      type: "story",
      choices,
    };
  }

  return {
    ...base,
    type: "ending",
    ending: {
      endingId: asString(isRecord(source.ending) ? source.ending.endingId : ""),
      rank: asString(isRecord(source.ending) ? source.ending.rank : "good") as QuestEndingNode["ending"]["rank"],
      stars: asNumber(isRecord(source.ending) ? source.ending.stars : 0),
      replayHint: asString(isRecord(source.ending) ? source.ending.replayHint : ""),
      rewardSummary: asString(isRecord(source.ending) ? source.ending.rewardSummary : ""),
      rewards: {
        coins: asNumber(
          isRecord(source.ending) && isRecord(source.ending.rewards) ? source.ending.rewards.coins : 0,
        ),
        items:
          isRecord(source.ending) &&
          isRecord(source.ending.rewards) &&
          Array.isArray(source.ending.rewards.items)
            ? source.ending.rewards.items.filter((entry): entry is string => typeof entry === "string")
            : [],
        achievements:
          isRecord(source.ending) &&
          isRecord(source.ending.rewards) &&
          Array.isArray(source.ending.rewards.achievements)
            ? source.ending.rewards.achievements.filter((entry): entry is string => typeof entry === "string")
            : [],
      },
    },
  };
}

export function validateQuestDefinition(rawQuest: unknown): QuestDefinition {
  const source = isRecord(rawQuest) ? rawQuest : {};
  const nodes = Array.isArray(source.nodes) ? source.nodes.map((node) => toQuestNode(node)) : [];

  const quest: QuestDefinition = {
    id: asString(source.id),
    slug: asString(source.slug),
    defaultLocale: asString(source.defaultLocale, "en-US"),
    availableLocales: [],
    title: asString(source.title),
    subtitle: asString(source.subtitle),
    author: asString(source.author),
    illustrator: asString(source.illustrator),
    narrator: asString(source.narrator),
    publisher: asString(source.publisher),
    copyright: asString(source.copyright),
    version: asString(source.version),
    difficulty: asString(source.difficulty, "easy") as QuestDefinition["difficulty"],
    coverImage: asString(source.coverImage),
    coverImageAlt: asString(source.coverImageAlt),
    summary: asString(source.summary),
    ageRange: asString(source.ageRange),
    readingLevel: asString(source.readingLevel),
    estimatedMinutes: asNumber(source.estimatedMinutes, 1),
    themes: Array.isArray(source.themes) ? source.themes.filter((entry): entry is string => typeof entry === "string") : [],
    contentWarnings: Array.isArray(source.contentWarnings)
      ? source.contentWarnings.filter((entry): entry is string => typeof entry === "string")
      : [],
    tags: Array.isArray(source.tags) ? source.tags.filter((entry): entry is string => typeof entry === "string") : [],
    meta: {
      totalNodes: asNumber(isRecord(source.meta) ? source.meta.totalNodes : 0),
      totalEndings: asNumber(isRecord(source.meta) ? source.meta.totalEndings : 0),
      replayEnabled: asBoolean(isRecord(source.meta) ? source.meta.replayEnabled : false),
    },
    credits: isRecord(source.credits)
      ? {
          story: asString(source.credits.story),
          artDirection: asString(source.credits.artDirection),
          audio: asString(source.credits.audio),
          notes: asString(source.credits.notes),
        }
      : undefined,
    startNodeId: asString(source.startNodeId),
    globalRewards: isRecord(source.globalRewards)
      ? {
          firstCompletion: isRecord(source.globalRewards.firstCompletion)
            ? {
                coins: asNumber(source.globalRewards.firstCompletion.coins, 0),
                items: Array.isArray(source.globalRewards.firstCompletion.items)
                  ? source.globalRewards.firstCompletion.items.filter((entry): entry is string => typeof entry === "string")
                  : [],
                achievements: Array.isArray(source.globalRewards.firstCompletion.achievements)
                  ? source.globalRewards.firstCompletion.achievements.filter(
                      (entry): entry is string => typeof entry === "string",
                    )
                  : [],
              }
            : undefined,
          allEndingsDiscovered: isRecord(source.globalRewards.allEndingsDiscovered)
            ? {
                coins: asNumber(source.globalRewards.allEndingsDiscovered.coins, 0),
                items: Array.isArray(source.globalRewards.allEndingsDiscovered.items)
                  ? source.globalRewards.allEndingsDiscovered.items.filter((entry): entry is string => typeof entry === "string")
                  : [],
                achievements: Array.isArray(source.globalRewards.allEndingsDiscovered.achievements)
                  ? source.globalRewards.allEndingsDiscovered.achievements.filter(
                      (entry): entry is string => typeof entry === "string",
                    )
                  : [],
              }
            : undefined,
        }
      : undefined,
    locales: isRecord(source.locales)
      ? Object.fromEntries(
          Object.entries(source.locales)
            .filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]))
            .map(([locale, entryValue]) => [
              locale,
              {
                title: asString(entryValue.title),
                subtitle: asString(entryValue.subtitle),
                summary: asString(entryValue.summary),
                author: asString(entryValue.author),
                ageRange: asString(entryValue.ageRange),
                coverImageAlt: asString(entryValue.coverImageAlt),
                nodes: isRecord(entryValue.nodes)
                  ? Object.fromEntries(
                      Object.entries(entryValue.nodes)
                        .filter((nodeEntry): nodeEntry is [string, Record<string, unknown>] => isRecord(nodeEntry[1]))
                        .map(([nodeId, nodeValue]) => [
                          nodeId,
                          {
                            title: asString(nodeValue.title),
                            text: asString(nodeValue.text),
                            imageAlt: asString(nodeValue.imageAlt),
                            imageCaption: asString(nodeValue.imageCaption),
                            audioTitle: asString(nodeValue.audioTitle),
                            choices: isRecord(nodeValue.choices)
                              ? Object.fromEntries(
                                  Object.entries(nodeValue.choices)
                                    .filter((choiceEntry): choiceEntry is [string, Record<string, unknown>] => isRecord(choiceEntry[1]))
                                    .map(([choiceId, choiceValue]) => [
                                      choiceId,
                                      {
                                        label: asString(choiceValue.label),
                                        description: asString(choiceValue.description),
                                        requiredItemName: asString(choiceValue.requiredItemName),
                                        unavailableText: asString(choiceValue.unavailableText),
                                      },
                                    ]),
                                )
                              : undefined,
                            ending: isRecord(nodeValue.ending)
                              ? {
                                  replayHint: asString(nodeValue.ending.replayHint),
                                  rewardSummary: asString(nodeValue.ending.rewardSummary),
                                }
                              : undefined,
                          },
                        ]),
                    )
                  : undefined,
              },
            ]),
        )
      : undefined,
    nodes,
  };
  quest.availableLocales = Array.from(
    new Set([
      quest.defaultLocale,
      "en-US",
      ...Object.keys(quest.locales ?? {}),
    ].filter(Boolean)),
  );

  assert(Boolean(quest.id), "QUEST_ID_REQUIRED");
  assert(Boolean(quest.startNodeId), `QUEST_${quest.id}_START_NODE_REQUIRED`);
  assert(quest.meta.totalEndings > 0, `QUEST_${quest.id}_TOTAL_ENDINGS_REQUIRED`);
  assert(Boolean(quest.defaultLocale), `QUEST_${quest.id}_DEFAULT_LOCALE_REQUIRED`);
  assert(Boolean(quest.locales?.[quest.defaultLocale]?.title || quest.title), `QUEST_${quest.id}_DEFAULT_LOCALE_TITLE_REQUIRED`);
  assert(Boolean(quest.locales?.["en-US"]?.title || quest.title), `QUEST_${quest.id}_EN_US_TITLE_REQUIRED`);

  const nodeIds = new Set<string>();
  for (const node of quest.nodes) {
    assert(Boolean(node.id), `QUEST_${quest.id}_NODE_ID_REQUIRED`);
    assert(!nodeIds.has(node.id), `QUEST_${quest.id}_NODE_ID_DUPLICATE_${node.id}`);
    nodeIds.add(node.id);
    assert(node.type === "story" || node.type === "ending", `QUEST_${quest.id}_NODE_TYPE_INVALID_${node.id}`);
  }

  assert(nodeIds.has(quest.startNodeId), `QUEST_${quest.id}_START_NODE_INVALID_${quest.startNodeId}`);

  const endingIds = new Set<string>();
  for (const node of quest.nodes) {
    if (node.type === "story") {
      validateStoryNode(node, nodeIds);
      continue;
    }
    validateEndingNode(node, endingIds);
  }

  assert(endingIds.size > 0, `QUEST_${quest.id}_ENDING_REQUIRED`);
  assert(
    quest.meta.totalEndings === endingIds.size,
    `QUEST_${quest.id}_TOTAL_ENDINGS_MISMATCH_${quest.meta.totalEndings}_${endingIds.size}`,
  );

  return quest;
}
