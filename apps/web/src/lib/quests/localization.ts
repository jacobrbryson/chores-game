import { DEFAULT_LOCALE, normalizeLocale, resolveLocalePreference, type AppLocale } from "@packages/locales";
import type {
  QuestChoice,
  QuestDefinition,
  QuestEndingNode,
  QuestLocalizedChoiceContent,
  QuestLocalizedContent,
  QuestNode,
  QuestStoryNode,
} from "@/lib/quests/types";

function localeChain(input: {
  requestedLocale?: string | null;
  questDefaultLocale?: string | null;
}) {
  const resolved = resolveLocalePreference({
    requestedLocale: input.requestedLocale,
    familyLocale: input.questDefaultLocale,
    fallbackLocale: DEFAULT_LOCALE,
  });
  const questDefault = normalizeLocale(input.questDefaultLocale) || DEFAULT_LOCALE;
  return Array.from(new Set<AppLocale | string>([resolved, questDefault, DEFAULT_LOCALE]));
}

function pickText(_chain: string[], candidates: Array<string | undefined>) {
  for (const candidate of candidates) {
    if (candidate && candidate.trim()) {
      return candidate;
    }
  }
  return "";
}

function localeContent(quest: QuestDefinition, locale: string): QuestLocalizedContent | null {
  return quest.locales?.[locale] ?? null;
}

function resolveChoice(
  choice: QuestChoice,
  localizedNodeChoices: Record<string, QuestLocalizedChoiceContent> | undefined,
  chain: string[],
): QuestChoice {
  const localizedChoice = localizedNodeChoices?.[choice.id];
  return {
    ...choice,
    label: pickText(chain, [localizedChoice?.label, choice.label]),
    description: pickText(chain, [localizedChoice?.description, choice.description]),
    requiredItemName: pickText(chain, [localizedChoice?.requiredItemName, choice.requiredItemName]),
    unavailableText: pickText(chain, [localizedChoice?.unavailableText, choice.unavailableText]),
  };
}

function resolveNode(node: QuestNode, quest: QuestDefinition, chain: string[]): QuestNode {
  const localizedNodeEntries = chain
    .map((locale) => localeContent(quest, locale)?.nodes?.[node.id])
    .filter(Boolean);
  const firstLocalizedNode = localizedNodeEntries[0];

  if (node.type === "story") {
    const storyNode = node as QuestStoryNode;
    return {
      ...storyNode,
      title: pickText(chain, [...localizedNodeEntries.map((entry) => entry?.title), storyNode.title]),
      text: pickText(chain, [...localizedNodeEntries.map((entry) => entry?.text), storyNode.text]),
      imageAlt: pickText(chain, [...localizedNodeEntries.map((entry) => entry?.imageAlt), storyNode.imageAlt, storyNode.title]),
      imageCaption: pickText(chain, [...localizedNodeEntries.map((entry) => entry?.imageCaption), storyNode.imageCaption]),
      audioTitle: pickText(chain, [...localizedNodeEntries.map((entry) => entry?.audioTitle), storyNode.audioTitle, storyNode.title]),
      choices: storyNode.choices.map((choice) => resolveChoice(choice, firstLocalizedNode?.choices, chain)),
    };
  }

  const endingNode = node as QuestEndingNode;
  return {
    ...endingNode,
    title: pickText(chain, [...localizedNodeEntries.map((entry) => entry?.title), endingNode.title]),
    text: pickText(chain, [...localizedNodeEntries.map((entry) => entry?.text), endingNode.text]),
    imageAlt: pickText(chain, [...localizedNodeEntries.map((entry) => entry?.imageAlt), endingNode.imageAlt, endingNode.title]),
    imageCaption: pickText(chain, [...localizedNodeEntries.map((entry) => entry?.imageCaption), endingNode.imageCaption]),
    audioTitle: pickText(chain, [...localizedNodeEntries.map((entry) => entry?.audioTitle), endingNode.audioTitle, endingNode.title]),
    ending: {
      ...endingNode.ending,
      replayHint: pickText(
        chain,
        [...localizedNodeEntries.map((entry) => entry?.ending?.replayHint), endingNode.ending.replayHint],
      ),
      rewardSummary: pickText(
        chain,
        [...localizedNodeEntries.map((entry) => entry?.ending?.rewardSummary), endingNode.ending.rewardSummary],
      ),
    },
  };
}

export function resolveQuestLocale(quest: QuestDefinition, requestedLocale?: string | null) {
  const chain = localeChain({
    requestedLocale,
    questDefaultLocale: quest.defaultLocale,
  });
  const localizedEntries = chain.map((locale) => localeContent(quest, locale)).filter(Boolean);

  return {
    ...quest,
    title: pickText(chain, [...localizedEntries.map((entry) => entry?.title), quest.title]),
    subtitle: pickText(chain, [...localizedEntries.map((entry) => entry?.subtitle), quest.subtitle]),
    summary: pickText(chain, [...localizedEntries.map((entry) => entry?.summary), quest.summary]),
    author: pickText(chain, [...localizedEntries.map((entry) => entry?.author), quest.author]),
    ageRange: pickText(chain, [...localizedEntries.map((entry) => entry?.ageRange), quest.ageRange]),
    coverImageAlt: pickText(chain, [...localizedEntries.map((entry) => entry?.coverImageAlt), quest.coverImageAlt, quest.title]),
    nodes: quest.nodes.map((node) => resolveNode(node, quest, chain)),
  };
}
