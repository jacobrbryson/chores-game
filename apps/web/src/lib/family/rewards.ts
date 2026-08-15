import {
  isValidFamilyRewardCoinCost,
  isValidFamilyRewardLimit,
  MAX_FAMILY_REWARD_DESCRIPTION_LENGTH,
  normalizeFamilyRewardCoinCost,
  normalizeFamilyRewardDescription,
  normalizeFamilyRewardImageId,
  normalizeFamilyRewardLimit,
  type FamilyReward,
} from "@packages/core";
import {
  documentIdFromName,
  listDocuments,
  readBoolean,
  readInteger,
  readString,
  readTimestamp,
  type FirestoreValue,
} from "@/lib/firestore/rest";

// The Family Award shape, artwork options, and field validation live in
// @packages/core so the web awards tab and the mobile Manage Family awards tab
// enforce identical rules. Re-exported here so existing `@/lib/family/rewards`
// imports keep working; the Firestore parsing below stays web-only.
export {
  FAMILY_REWARD_IMAGE_OPTIONS,
  MAX_FAMILY_REWARD_COIN_COST,
  MAX_FAMILY_REWARD_DESCRIPTION_LENGTH,
  MAX_FAMILY_REWARD_LIMIT,
  MIN_FAMILY_REWARD_COIN_COST,
  findFamilyRewardImageOption,
  isFamilyRewardImageId,
  isValidFamilyRewardCoinCost,
  isValidFamilyRewardLimit,
  normalizeFamilyRewardCoinCost,
  normalizeFamilyRewardDescription,
  normalizeFamilyRewardImageId,
  normalizeFamilyRewardLimit,
  type FamilyReward,
  type FamilyRewardImageOption,
} from "@packages/core";

export function parseFamilyRewards(
  docs: Array<{ name: string; fields?: Record<string, FirestoreValue> }>,
  options?: { includeDisabled?: boolean },
): FamilyReward[] {
  const includeDisabled = options?.includeDisabled === true;
  return docs
    .map((doc) => {
      const id = documentIdFromName(doc.name);
      const deleted = readBoolean(doc.fields, "deleted");
      const disabled = readBoolean(doc.fields, "disabled");
      const description = normalizeFamilyRewardDescription(
        readString(doc.fields, "description"),
      ).slice(0, MAX_FAMILY_REWARD_DESCRIPTION_LENGTH);
      const coinCost = normalizeFamilyRewardCoinCost(readInteger(doc.fields, "coinCost"));
      const imageId = normalizeFamilyRewardImageId(readString(doc.fields, "imageId"));
      const individualLimit = normalizeFamilyRewardLimit(readInteger(doc.fields, "individualLimit"));
      const familyLimit = normalizeFamilyRewardLimit(readInteger(doc.fields, "familyLimit"));
      const familyRedeemedCount = normalizeFamilyRewardLimit(
        readInteger(doc.fields, "familyRedeemedCount"),
      );
      const communityAwardSubmissionStatus = readString(doc.fields, "communityAwardSubmissionStatus");
      return {
        id,
        deleted,
        disabled,
        description,
        coinCost,
        imageId,
        individualLimit,
        familyLimit,
        familyRedeemedCount,
        submitToCommunityAwards: readBoolean(doc.fields, "submitToCommunityAwards"),
        communityAwardSubmissionId: readString(doc.fields, "communityAwardSubmissionId") || null,
        communityAwardSubmissionStatus: communityAwardSubmissionStatus || null,
        communityAwardSubmittedAt: readTimestamp(doc.fields, "communityAwardSubmittedAt") || null,
        communityAwardReviewedAt: readTimestamp(doc.fields, "communityAwardReviewedAt") || null,
        communityAwardRejectionReason: readString(doc.fields, "communityAwardRejectionReason") || null,
      };
    })
    .filter(
      (reward) =>
        !reward.deleted &&
        (includeDisabled || !reward.disabled) &&
        Boolean(reward.id) &&
        Boolean(reward.description) &&
        isValidFamilyRewardCoinCost(reward.coinCost) &&
        isValidFamilyRewardLimit(reward.individualLimit) &&
        isValidFamilyRewardLimit(reward.familyLimit),
    )
    .sort((a, b) => a.description.localeCompare(b.description))
    .map((reward) => ({
      id: reward.id,
      description: reward.description,
      coinCost: reward.coinCost,
      imageId: reward.imageId,
      individualLimit: reward.individualLimit > 0 ? reward.individualLimit : undefined,
      familyLimit: reward.familyLimit > 0 ? reward.familyLimit : undefined,
      familyRedeemedCount: reward.familyRedeemedCount > 0 ? reward.familyRedeemedCount : undefined,
      disabled: reward.disabled === true,
      submitToCommunityAwards: reward.submitToCommunityAwards === true,
      communityAwardSubmissionId: reward.communityAwardSubmissionId,
      communityAwardSubmissionStatus: reward.communityAwardSubmissionStatus,
      communityAwardSubmittedAt: reward.communityAwardSubmittedAt,
      communityAwardReviewedAt: reward.communityAwardReviewedAt,
      communityAwardRejectionReason: reward.communityAwardRejectionReason,
    }));
}

export async function listFamilyRewards(
  familyId: string,
  idToken: string,
  pageSize = 300,
  options?: { includeDisabled?: boolean },
) {
  const docs = await listDocuments(`families/${familyId}/rewards`, idToken, pageSize);
  return parseFamilyRewards(docs, options);
}
