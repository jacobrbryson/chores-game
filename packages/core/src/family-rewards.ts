// Family Award shape, artwork choices, and field validation. Parents create
// awards ("extra screen time", "movie night") that kids redeem with coins.
//
// This lives in @packages/core because the web /family awards tab and the mobile
// Manage Family awards tab render the same picker and enforce the same limits —
// the artwork list, the coin-cost bounds, and the redemption-limit rules must not
// drift between the two apps. Firestore parsing stays in the web app.

export type FamilyReward = {
  id: string;
  description: string;
  coinCost: number;
  imageId: string;
  individualLimit?: number;
  familyLimit?: number;
  familyRedeemedCount?: number;
  disabled?: boolean;
  submitToCommunityAwards?: boolean;
  communityAwardSubmissionId?: string | null;
  communityAwardSubmissionStatus?: string | null;
  communityAwardSubmittedAt?: string | null;
  communityAwardReviewedAt?: string | null;
  communityAwardRejectionReason?: string | null;
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
  { id: "sleepover", label: "Custom", imagePath: "/custom.png" },
];

export const MAX_FAMILY_REWARD_DESCRIPTION_LENGTH = 120;
export const MIN_FAMILY_REWARD_COIN_COST = 1;
export const MAX_FAMILY_REWARD_COIN_COST = 10000;
export const MAX_FAMILY_REWARD_LIMIT = 10000;

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

// An empty limit means "unlimited" and normalizes to 0. A non-numeric value
// returns -1 so callers can reject it rather than silently treating it as
// unlimited.
export function normalizeFamilyRewardLimit(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return -1;
  }
  return Math.floor(parsed);
}

export function isValidFamilyRewardLimit(value: number) {
  return Number.isInteger(value) && value >= 0 && value <= MAX_FAMILY_REWARD_LIMIT;
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
