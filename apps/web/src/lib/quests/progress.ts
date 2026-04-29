import { randomUUID } from "node:crypto";
import {
  arrayField,
  boolField,
  commitWrites,
  createOrReplaceDocument,
  getDocument,
  integerField,
  listDocuments,
  mapField,
  readInteger,
  readString,
  readStringArray,
  readTimestamp,
  signedIntegerField,
  stringArrayField,
  stringField,
  timestampField,
  type FirestoreValue,
} from "@/lib/firestore/rest";
import { findGameItemById } from "@/lib/items/catalog";
import type { QuestChoice, QuestDefinition, QuestProgress } from "@/lib/quests/types";

export type InventoryEntry = {
  itemId: string;
  quantity: number;
  totalAcquired: number;
  totalConsumed: number;
  updatedAt: string;
};

function asString(value: FirestoreValue | undefined) {
  if (!value || !("stringValue" in value)) {
    return "";
  }
  return value.stringValue;
}

function asInt(value: FirestoreValue | undefined) {
  if (!value) {
    return 0;
  }
  if ("integerValue" in value) {
    const parsed = Number(value.integerValue);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function readChoiceRecords(
  fields: Record<string, FirestoreValue> | undefined,
): QuestProgress["choicesMade"] {
  const source = fields?.choicesMade;
  if (!source || !("arrayValue" in source)) {
    return [];
  }
  return (source.arrayValue.values ?? [])
    .filter((entry): entry is Extract<FirestoreValue, { mapValue: unknown }> => "mapValue" in entry)
    .map((entry) => {
      const map = entry.mapValue.fields ?? {};
      return {
        choiceId: asString(map.choiceId),
        fromNodeId: asString(map.fromNodeId),
        toNodeId: asString(map.toNodeId),
        usedItemId: asString(map.usedItemId),
        purchasedBeforeUse: asString(map.purchasedBeforeUse) === "true",
        consumedItem: asString(map.consumedItem) === "true",
        createdAt: asString(map.createdAt),
      };
    })
    .filter((entry) => Boolean(entry.choiceId) && Boolean(entry.toNodeId));
}

function toInventoryEntry(fields: Record<string, FirestoreValue> | undefined): InventoryEntry {
  return {
    itemId: readString(fields, "itemId"),
    quantity: Math.max(0, readInteger(fields, "quantity")),
    totalAcquired: Math.max(0, readInteger(fields, "totalAcquired")),
    totalConsumed: Math.max(0, readInteger(fields, "totalConsumed")),
    updatedAt: readTimestamp(fields, "updatedAt"),
  };
}

function toQuestProgress(
  uid: string,
  questId: string,
  startNodeId: string,
  fields: Record<string, FirestoreValue> | undefined,
): QuestProgress {
  const statusRaw = readString(fields, "status");
  const status =
    statusRaw === "in_progress" || statusRaw === "completed" ? statusRaw : "not_started";
  return {
    userId: uid,
    questId,
    currentNodeId: readString(fields, "currentNodeId") || startNodeId,
    status,
    choicesMade: readChoiceRecords(fields),
    endingsReached: readStringArray(fields, "endingsReached"),
    bestEndingId: readString(fields, "bestEndingId"),
    timesPlayed: Math.max(0, readInteger(fields, "timesPlayed")),
    completedAt: readTimestamp(fields, "completedAt"),
    lastPlayedAt: readTimestamp(fields, "lastPlayedAt"),
    updatedAt: readTimestamp(fields, "updatedAt"),
    firstCompletionRewardGrantedAt: readTimestamp(fields, "firstCompletionRewardGrantedAt") || undefined,
    allEndingsRewardGrantedAt: readTimestamp(fields, "allEndingsRewardGrantedAt") || undefined,
    endingRewardIdsGranted: readStringArray(fields, "endingRewardIdsGranted"),
  };
}

export function createDefaultQuestProgress(uid: string, quest: QuestDefinition): QuestProgress {
  return {
    userId: uid,
    questId: quest.id,
    currentNodeId: quest.startNodeId,
    status: "not_started",
    choicesMade: [],
    endingsReached: [],
    bestEndingId: "",
    timesPlayed: 0,
    completedAt: "",
    lastPlayedAt: "",
    updatedAt: "",
    endingRewardIdsGranted: [],
  };
}

function toChoiceField(choice: QuestProgress["choicesMade"][number]): FirestoreValue {
  return mapField({
    choiceId: stringField(choice.choiceId),
    fromNodeId: stringField(choice.fromNodeId),
    toNodeId: stringField(choice.toNodeId),
    usedItemId: stringField(choice.usedItemId),
    purchasedBeforeUse: stringField(choice.purchasedBeforeUse ? "true" : "false"),
    consumedItem: stringField(choice.consumedItem ? "true" : "false"),
    createdAt: stringField(choice.createdAt),
  });
}

function questProgressFields(progress: QuestProgress) {
  return {
    userId: stringField(progress.userId),
    questId: stringField(progress.questId),
    currentNodeId: stringField(progress.currentNodeId),
    status: stringField(progress.status),
    choicesMade: arrayField(progress.choicesMade.map((entry) => toChoiceField(entry))),
    endingsReached: stringArrayField(progress.endingsReached),
    bestEndingId: stringField(progress.bestEndingId),
    timesPlayed: integerField(progress.timesPlayed),
    completedAt: progress.completedAt ? timestampField(progress.completedAt) : stringField(""),
    lastPlayedAt: progress.lastPlayedAt ? timestampField(progress.lastPlayedAt) : stringField(""),
    updatedAt: progress.updatedAt ? timestampField(progress.updatedAt) : stringField(""),
    firstCompletionRewardGrantedAt: progress.firstCompletionRewardGrantedAt
      ? timestampField(progress.firstCompletionRewardGrantedAt)
      : stringField(""),
    allEndingsRewardGrantedAt: progress.allEndingsRewardGrantedAt
      ? timestampField(progress.allEndingsRewardGrantedAt)
      : stringField(""),
    endingRewardIdsGranted: stringArrayField(progress.endingRewardIdsGranted),
  };
}

export async function getQuestProgress(uid: string, quest: QuestDefinition, idToken: string) {
  try {
    const doc = await getDocument(`users/${uid}/questProgress/${quest.id}`, idToken);
    return toQuestProgress(uid, quest.id, quest.startNodeId, doc.fields);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("FIRESTORE_HTTP_404")) {
      return createDefaultQuestProgress(uid, quest);
    }
    throw error;
  }
}

export async function getQuestProgressWithMeta(uid: string, quest: QuestDefinition, idToken: string) {
  try {
    const doc = await getDocument(`users/${uid}/questProgress/${quest.id}`, idToken);
    return {
      progress: toQuestProgress(uid, quest.id, quest.startNodeId, doc.fields),
      updateTime: doc.updateTime ?? "",
      exists: true,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("FIRESTORE_HTTP_404")) {
      return {
        progress: createDefaultQuestProgress(uid, quest),
        updateTime: "",
        exists: false,
      };
    }
    throw error;
  }
}

export async function listQuestProgress(uid: string, idToken: string) {
  try {
    const docs = await listDocuments(`users/${uid}/questProgress`, idToken, 300);
    return docs.map((doc) => {
      const questId = doc.name.split("/").pop() ?? "";
      return toQuestProgress(uid, questId, "", doc.fields);
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("FIRESTORE_HTTP_404")) {
      return [];
    }
    throw error;
  }
}

export async function listInventoryByItemId(uid: string, idToken: string) {
  try {
    const docs = await listDocuments(`users/${uid}/inventory`, idToken, 400);
    const map = new Map<string, InventoryEntry>();
    for (const doc of docs) {
      const entry = toInventoryEntry(doc.fields);
      const itemId = entry.itemId || doc.name.split("/").pop() || "";
      if (!itemId) {
        continue;
      }
      map.set(itemId, {
        ...entry,
        itemId,
      });
    }
    return map;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("FIRESTORE_HTTP_404")) {
      return new Map<string, InventoryEntry>();
    }
    throw error;
  }
}

export function resolveChoiceMissingReason(
  choice: QuestChoice,
  ownedQuantity: number,
  currentCoins: number,
) {
  const item = findGameItemById(choice.requiredItemId);
  if (ownedQuantity > 0) {
    return "";
  }
  if (!item) {
    return "required_item_not_found";
  }
  if (!choice.purchaseBehavior.allowPurchaseIfMissing || !item.purchasable) {
    return "required_item_not_purchasable";
  }
  if (currentCoins < item.price) {
    return "insufficient_funds";
  }
  return "";
}

function rankWeight(rank: string) {
  if (rank === "best") {
    return 4;
  }
  if (rank === "great") {
    return 3;
  }
  if (rank === "good") {
    return 2;
  }
  return 1;
}

export function resolveBestEndingId(
  currentBestEndingId: string,
  candidateEndingId: string,
  endingNodesByEndingId: Map<string, QuestDefinition["nodes"][number]>,
) {
  const currentBestNode = endingNodesByEndingId.get(currentBestEndingId);
  const candidateNode = endingNodesByEndingId.get(candidateEndingId);
  if (!candidateNode || candidateNode.type !== "ending") {
    return currentBestEndingId;
  }
  if (!currentBestNode || currentBestNode.type !== "ending") {
    return candidateEndingId;
  }
  const currentRank = rankWeight(currentBestNode.ending.rank);
  const candidateRank = rankWeight(candidateNode.ending.rank);
  if (candidateRank > currentRank) {
    return candidateEndingId;
  }
  if (candidateRank < currentRank) {
    return currentBestEndingId;
  }
  return candidateNode.ending.stars > currentBestNode.ending.stars
    ? candidateEndingId
    : currentBestEndingId;
}

export async function saveQuestProgress(
  uid: string,
  questId: string,
  progress: QuestProgress,
  idToken: string,
) {
  await createOrReplaceDocument(
    `users/${uid}/questProgress/${questId}`,
    questProgressFields(progress),
    idToken,
  );
}

export async function commitQuestChoiceWithOptionalPurchase(input: {
  uid: string;
  idToken: string;
  nowIso: string;
  questId: string;
  nextProgress: QuestProgress;
  previousProgressUpdateTime?: string;
  requiredItemId: string;
  purchasePrice: number;
  rewardCoins: number;
  rewardItemIds: string[];
  shouldPurchase: boolean;
  consumeItem: boolean;
  nextWalletBalance: number;
  currentUserUpdateTime: string;
  inventoryByItemId: Map<string, InventoryEntry>;
  resultingInventoryQuantity: number;
}) {
  const writes: Array<{
    update: {
      path: string;
      fields: Record<string, FirestoreValue>;
      updateMask?: string[];
      currentDocument?: { exists?: boolean; updateTime?: string };
    };
  }> = [];

  const questFields = questProgressFields(input.nextProgress);
  writes.push({
    update: {
      path: `users/${input.uid}/questProgress/${input.questId}`,
      fields: questFields,
      currentDocument: input.previousProgressUpdateTime
        ? { updateTime: input.previousProgressUpdateTime }
        : { exists: false },
    },
  });

  const walletChanged = input.shouldPurchase || input.rewardCoins > 0;
  if (walletChanged) {
    writes.push({
      update: {
        path: `users/${input.uid}`,
        fields: {
          walletBalance: integerField(input.nextWalletBalance),
          walletUpdatedAt: timestampField(input.nowIso),
        },
        updateMask: ["walletBalance", "walletUpdatedAt"],
        currentDocument: { updateTime: input.currentUserUpdateTime },
      },
    });
  }

  if (input.shouldPurchase) {
    writes.push({
      update: {
        path: `users/${input.uid}/walletLedger/${randomUUID()}`,
        fields: {
          uid: stringField(input.uid),
          reason: stringField("store_purchase"),
          delta: signedIntegerField(-Math.abs(input.purchasePrice)),
          entryType: stringField("debit"),
          creditAmount: integerField(0),
          debitAmount: integerField(Math.abs(input.purchasePrice)),
          balanceAfter: integerField(input.nextWalletBalance),
          countsTowardBalance: boolField(true),
          choreId: stringField(""),
          itemId: stringField(input.requiredItemId),
          createdAt: timestampField(input.nowIso),
        },
      },
    });
  }

  if (input.rewardCoins > 0) {
    writes.push({
      update: {
        path: `users/${input.uid}/walletLedger/${randomUUID()}`,
        fields: {
          uid: stringField(input.uid),
          reason: stringField("quest_reward"),
          delta: signedIntegerField(Math.abs(input.rewardCoins)),
          entryType: stringField("credit"),
          creditAmount: integerField(Math.abs(input.rewardCoins)),
          debitAmount: integerField(0),
          balanceAfter: integerField(input.nextWalletBalance),
          countsTowardBalance: boolField(true),
          choreId: stringField(""),
          itemId: stringField(input.questId),
          createdAt: timestampField(input.nowIso),
        },
      },
    });
  }

  const previousInventory = input.inventoryByItemId.get(input.requiredItemId) ?? null;
  const nextInventoryQuantity = Math.max(0, input.resultingInventoryQuantity);
  const nextTotalAcquired = (previousInventory?.totalAcquired ?? 0) + (input.shouldPurchase ? 1 : 0);
  const nextTotalConsumed = (previousInventory?.totalConsumed ?? 0) + (input.consumeItem ? 1 : 0);
  writes.push({
    update: {
      path: `users/${input.uid}/inventory/${input.requiredItemId}`,
      fields: {
        itemId: stringField(input.requiredItemId),
        quantity: integerField(nextInventoryQuantity),
        totalAcquired: integerField(nextTotalAcquired),
        totalConsumed: integerField(nextTotalConsumed),
        updatedAt: timestampField(input.nowIso),
      },
      currentDocument: previousInventory ? { exists: true } : { exists: false },
    },
  });

  for (const rewardItemId of input.rewardItemIds) {
    const existingRewardInventory = input.inventoryByItemId.get(rewardItemId) ?? null;
    writes.push({
      update: {
        path: `users/${input.uid}/inventory/${rewardItemId}`,
        fields: {
          itemId: stringField(rewardItemId),
          quantity: integerField((existingRewardInventory?.quantity ?? 0) + 1),
          totalAcquired: integerField((existingRewardInventory?.totalAcquired ?? 0) + 1),
          totalConsumed: integerField(existingRewardInventory?.totalConsumed ?? 0),
          updatedAt: timestampField(input.nowIso),
        },
        currentDocument: existingRewardInventory ? { exists: true } : { exists: false },
      },
    });
  }

  await commitWrites(writes, input.idToken);
}

export async function grantQuestRewards(input: {
  uid: string;
  idToken: string;
  nowIso: string;
  itemIds: string[];
}) {
  if (input.itemIds.length === 0) {
    return;
  }
  const inventoryByItemId = await listInventoryByItemId(input.uid, input.idToken);
  for (const itemId of input.itemIds) {
    const existing = inventoryByItemId.get(itemId);
    await createOrReplaceDocument(
      `users/${input.uid}/inventory/${itemId}`,
      {
        itemId: stringField(itemId),
        quantity: integerField((existing?.quantity ?? 0) + 1),
        totalAcquired: integerField((existing?.totalAcquired ?? 0) + 1),
        totalConsumed: integerField(existing?.totalConsumed ?? 0),
        updatedAt: timestampField(input.nowIso),
      },
      input.idToken,
    );
  }
}
