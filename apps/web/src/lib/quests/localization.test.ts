import { describe, expect, it } from "vitest";
import { resolveQuestLocale } from "@/lib/quests/localization";
import { validateQuestDefinition } from "@/lib/quests/validation";

describe("quest localization", () => {
  const quest = validateQuestDefinition({
    id: "quest-localized",
    slug: "quest-localized",
    defaultLocale: "en-US",
    title: "English title",
    subtitle: "English subtitle",
    author: "Author",
    version: "1.0.0",
    difficulty: "easy",
    summary: "English summary",
    ageRange: "6-9",
    estimatedMinutes: 5,
    themes: [],
    contentWarnings: [],
    tags: [],
    meta: {
      totalNodes: 2,
      totalEndings: 1,
      replayEnabled: true,
    },
    startNodeId: "page-1",
    locales: {
      "fr-FR": {
        title: "Titre francais",
        summary: "Resume francais",
      },
      "en-US": {
        title: "English title",
        summary: "English summary",
        nodes: {
          "page-1": {
            title: "English page",
            text: "English body",
            choices: {
              "choice-a": {
                label: "English choice",
                description: "English choice body",
              },
            },
          },
        },
      },
      "es-US": {
        title: "Titulo espanol",
        summary: "Resumen espanol",
        nodes: {
          "page-1": {
            title: "Pagina espanola",
          },
        },
      },
    },
    nodes: [
      {
        id: "page-1",
        type: "story",
        title: "English page",
        text: "English body",
        choices: [
          {
            id: "choice-a",
            label: "English choice",
            description: "English choice body",
            consumeItem: false,
            purchaseBehavior: {
              allowPurchaseIfMissing: false,
              purchaseAndUseImmediately: false,
            },
            nextNodeId: "ending-1",
          },
        ],
      },
      {
        id: "ending-1",
        type: "ending",
        title: "English ending",
        text: "English ending body",
        ending: {
          endingId: "ending-1",
          rank: "good",
          stars: 3,
          rewardSummary: "Reward",
          rewards: { coins: 0, items: [], achievements: [] },
        },
      },
    ],
  });

  it("resolves the requested locale when localized content exists", () => {
    const resolved = resolveQuestLocale(quest, "es-US");
    expect(resolved.title).toBe("Titulo espanol");
    expect(resolved.summary).toBe("Resumen espanol");
    expect(resolved.nodes[0]?.title).toBe("Pagina espanola");
  });

  it("falls back from fr-FR to the default quest locale when nested content is missing", () => {
    const resolved = resolveQuestLocale(quest, "fr-FR");
    expect(resolved.title).toBe("Titre francais");
    expect(resolved.summary).toBe("Resume francais");
    expect(resolved.nodes[0]?.title).toBe("English page");
  });

  it("falls back to default locale and en-US for missing translations", () => {
    const resolved = resolveQuestLocale(quest, "es-US");
    const storyNode = resolved.nodes[0];
    expect(storyNode?.type).toBe("story");
    if (storyNode?.type !== "story") {
      throw new Error("expected story node");
    }
    expect(storyNode.text).toBe("English body");
    expect(storyNode.choices[0]?.label).toBe("English choice");
  });
});
