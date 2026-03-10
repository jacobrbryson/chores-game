import {
  documentIdFromName,
  listDocuments,
  readBoolean,
  readInteger,
  readString,
  type FirestoreValue,
} from "@/lib/firestore/rest";

export type FamilyReward = {
  id: string;
  description: string;
  coinCost: number;
  imageId: string;
};

export type FamilyRewardImageOption = {
  id: string;
  label: string;
  imagePath: string;
};

export const FAMILY_REWARD_IMAGE_OPTIONS: FamilyRewardImageOption[] = [
  { id: "screen_time", label: "Extra Screen Time", imagePath: "/rewards/screens.png" },
  { id: "ice_cream", label: "Ice Cream", imagePath: "/rewards/icecream.png" },
  { id: "candy", label: "Candy", imagePath: "/rewards/candy.png" },
  { id: "soda", label: "Soda", imagePath: "/rewards/sodas.png" },
  { id: "zoo_trip", label: "Zoo Trip", imagePath: "/rewards/zoo.png" },
  { id: "museum_trip", label: "Museum Trip", imagePath: "/rewards/museum.png" },
  { id: "vacation", label: "Vacation", imagePath: "/rewards/vacation.png" },
  { id: "movie_night", label: "Movie Night", imagePath: "/rewards/movie.png" },
  { id: "sleepover", label: "Sleepover", imagePath: "/rewards/sleep.png" },
];

export const MAX_FAMILY_REWARD_DESCRIPTION_LENGTH = 120;
export const MIN_FAMILY_REWARD_COIN_COST = 1;
export const MAX_FAMILY_REWARD_COIN_COST = 10000;

const DEFAULT_FAMILY_REWARD_IMAGE_ID = FAMILY_REWARD_IMAGE_OPTIONS[0]?.id ?? "screen_time";
const IMAGE_ID_SET = new Set(FAMILY_REWARD_IMAGE_OPTIONS.map((entry) => entry.id));

export function normalizeFamilyRewardDescription(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeFamilyRewardCoinCost(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.floor(parsed);
}

export function isValidFamilyRewardCoinCost(value: number) {
  return (
    Number.isInteger(value) &&
    value >= MIN_FAMILY_REWARD_COIN_COST &&
    value <= MAX_FAMILY_REWARD_COIN_COST
  );
}

export function isFamilyRewardImageId(value: string) {
  return IMAGE_ID_SET.has(value);
}

export function normalizeFamilyRewardImageId(value: string) {
  const normalized = value.trim();
  return isFamilyRewardImageId(normalized) ? normalized : DEFAULT_FAMILY_REWARD_IMAGE_ID;
}

export function findFamilyRewardImageOption(imageId: string) {
  return FAMILY_REWARD_IMAGE_OPTIONS.find((entry) => entry.id === imageId) ?? null;
}

export function parseFamilyRewards(
  docs: Array<{ name: string; fields?: Record<string, FirestoreValue> }>,
): FamilyReward[] {
  return docs
    .map((doc) => {
      const id = documentIdFromName(doc.name);
      const deleted = readBoolean(doc.fields, "deleted");
      const description = normalizeFamilyRewardDescription(
        readString(doc.fields, "description"),
      ).slice(0, MAX_FAMILY_REWARD_DESCRIPTION_LENGTH);
      const coinCost = normalizeFamilyRewardCoinCost(readInteger(doc.fields, "coinCost"));
      const imageId = normalizeFamilyRewardImageId(readString(doc.fields, "imageId"));
      return { id, deleted, description, coinCost, imageId };
    })
    .filter(
      (reward) =>
        !reward.deleted &&
        Boolean(reward.id) &&
        Boolean(reward.description) &&
        isValidFamilyRewardCoinCost(reward.coinCost),
    )
    .sort((a, b) => a.description.localeCompare(b.description))
    .map((reward) => ({
      id: reward.id,
      description: reward.description,
      coinCost: reward.coinCost,
      imageId: reward.imageId,
    }));
}

export async function listFamilyRewards(familyId: string, idToken: string, pageSize = 300) {
  const docs = await listDocuments(`families/${familyId}/rewards`, idToken, pageSize);
  return parseFamilyRewards(docs);
}
