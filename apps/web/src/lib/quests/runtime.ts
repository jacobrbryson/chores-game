import { findGameItemById } from "@/lib/items/catalog";
import type { QuestChoice, QuestDefinition, QuestNode, QuestProgress, QuestStoryNode } from "@/lib/quests/types";

export type QuestChoiceRuntime = {
  id: string;
  label: string;
  description: string;
  requiredItemId: string;
  requiredItemName: string;
  requiredItemImage: string;
  consumeItem: boolean;
  allowPurchaseIfMissing: boolean;
  purchaseAndUseImmediately: boolean;
  purchasable: boolean;
  canAfford: boolean;
  price: number;
  ownedQuantity: number;
  owned: boolean;
  madeBefore: boolean;
  disabled: boolean;
  actionText: string;
  unavailableText: string;
  nextNodeId: string;
};

export type QuestNodeRuntime = Omit<QuestNode, "choices"> & {
  choices?: QuestChoiceRuntime[];
};

function toActionText(input: {
  choice: QuestChoice;
  itemName: string;
  ownedQuantity: number;
  purchasable: boolean;
  canAfford: boolean;
  price: number;
}) {
  if (!input.choice.requiredItemId?.trim()) {
    return "Continue";
  }
  if (input.ownedQuantity > 0) {
    return `Use ${input.itemName}`;
  }
  if (!input.purchasable) {
    return "Item Required";
  }
  if (!input.canAfford) {
    return `Need ${input.price} coins`;
  }
  return `Buy & Use ${input.itemName} — ${input.price} coins`;
}

function toUnavailableText(choice: QuestChoice, fallback: string) {
  const candidate = choice.unavailableText?.trim();
  if (candidate) {
    return candidate;
  }
  return fallback;
}

export function toRuntimeChoice(
  choice: QuestChoice,
  ownedQuantity: number,
  walletBalance: number,
  madeBefore: boolean,
): QuestChoiceRuntime {
  const requiredItemId = choice.requiredItemId?.trim() ?? "";
  if (!requiredItemId) {
    return {
      id: choice.id,
      label: choice.label,
      description: choice.description,
      requiredItemId: "",
      requiredItemName: "Story Choice",
      requiredItemImage: "/assets/items/placeholder.png",
      consumeItem: false,
      allowPurchaseIfMissing: false,
      purchaseAndUseImmediately: false,
      purchasable: false,
      canAfford: true,
      price: 0,
      ownedQuantity: 0,
      owned: true,
      madeBefore,
      disabled: false,
      actionText: "Continue",
      unavailableText: "",
      nextNodeId: choice.nextNodeId,
    };
  }
  const item = findGameItemById(requiredItemId);
  const requiredItemName = item?.name || choice.requiredItemName || "Required Item";
  const requiredItemImage = item?.image || choice.requiredItemImage || "/assets/items/placeholder.png";
  const price = Math.max(0, item?.price ?? 0);
  const purchasable = Boolean(item?.purchasable) && choice.purchaseBehavior.allowPurchaseIfMissing;
  const owned = ownedQuantity > 0;
  const canAfford = walletBalance >= price;
  const disabled = !owned && (!purchasable || !canAfford);
  const unavailableText = toUnavailableText(
    choice,
    purchasable ? `Buy ${requiredItemName} first.` : `${requiredItemName} is required for this path.`,
  );

  return {
    id: choice.id,
    label: choice.label,
    description: choice.description,
    requiredItemId,
    requiredItemName,
    requiredItemImage,
    consumeItem: choice.consumeItem,
    allowPurchaseIfMissing: choice.purchaseBehavior.allowPurchaseIfMissing,
    purchaseAndUseImmediately: choice.purchaseBehavior.purchaseAndUseImmediately,
    purchasable,
    canAfford,
    price,
    ownedQuantity,
    owned,
    madeBefore,
    disabled,
    actionText: toActionText({
      choice,
      itemName: requiredItemName,
      ownedQuantity,
      purchasable,
      canAfford,
      price,
    }),
    unavailableText,
    nextNodeId: choice.nextNodeId,
  };
}

export function toRuntimeNode(input: {
  node: QuestNode;
  inventoryByItemId: Map<string, number>;
  walletBalance: number;
  choicesMadeByNodeId?: Map<string, Set<string>>;
}): QuestNodeRuntime {
  if (input.node.type !== "story") {
    return input.node;
  }
  const storyNode = input.node as QuestStoryNode;
  const choicesMadeAtNode = input.choicesMadeByNodeId?.get(storyNode.id) ?? new Set<string>();
  return {
    ...storyNode,
    choices: storyNode.choices.map((choice) =>
      toRuntimeChoice(
        choice,
        choice.requiredItemId ? input.inventoryByItemId.get(choice.requiredItemId) ?? 0 : 0,
        input.walletBalance,
        choicesMadeAtNode.has(choice.id),
      ),
    ),
  };
}

export function getQuestActionLabel(progress: QuestProgress): "Start" | "Continue" | "Replay" {
  if (progress.status === "completed") {
    return "Replay";
  }
  if (progress.status === "in_progress") {
    return "Continue";
  }
  return "Start";
}

export function getEndingNodeMap(quest: QuestDefinition) {
  const map = new Map<string, QuestNode>();
  for (const node of quest.nodes) {
    if (node.type !== "ending") {
      continue;
    }
    map.set(node.ending.endingId, node);
  }
  return map;
}
