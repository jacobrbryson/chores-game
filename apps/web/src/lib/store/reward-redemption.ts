import {
  integerField,
  stringField,
  timestampField,
  type FirestoreValue,
} from "@/lib/firestore/rest";

type BuildRewardClaimFieldsInput = {
  rewardId: string;
  rewardDescription: string;
  rewardImageId: string;
  coinCost: number;
  recipientUid: string;
  recipientName: string;
  recipientEmail: string;
  actorUid: string;
  actorName: string;
  consumed: boolean;
  now: string;
};

export function buildRewardClaimFields(
  input: BuildRewardClaimFieldsInput,
): Record<string, FirestoreValue> {
  return {
    rewardId: stringField(input.rewardId),
    rewardDescription: stringField(input.rewardDescription),
    rewardImageId: stringField(input.rewardImageId),
    coinCost: integerField(input.coinCost),
    purchaserUid: stringField(input.recipientUid),
    purchaserName: stringField(input.recipientName),
    purchaserEmail: stringField(input.recipientEmail),
    purchasedAt: timestampField(input.now),
    status: stringField(input.consumed ? "claimed" : "unclaimed"),
    ...(input.consumed ? { claimedAt: timestampField(input.now) } : {}),
    claimedByUid: stringField(input.consumed ? input.actorUid : ""),
    claimedByName: stringField(input.consumed ? input.actorName : ""),
    redeemedByUid: stringField(input.actorUid),
    redeemedByName: stringField(input.actorName),
    createdAt: timestampField(input.now),
    updatedAt: timestampField(input.now),
  };
}
