import {
  documentIdFromName,
  listDocuments,
  readBoolean,
  readInteger,
  readString,
  readTimestamp,
  type FirestoreValue,
} from "@/lib/firestore/rest";

export type FamilyAwardClaimStatus = "unclaimed" | "claimed";

export type FamilyAwardClaim = {
  id: string;
  rewardId: string;
  rewardDescription: string;
  rewardImageId: string;
  coinCost: number;
  purchaserUid: string;
  purchaserName: string;
  purchaserEmail: string;
  purchasedAt?: string;
  status: FamilyAwardClaimStatus;
  claimedAt?: string;
  claimedByUid?: string;
  claimedByName?: string;
};

function toUnixMillis(value?: string) {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function toClaimStatus(value: string): FamilyAwardClaimStatus {
  return value === "claimed" ? "claimed" : "unclaimed";
}

export function parseFamilyAwardClaims(
  docs: Array<{ name: string; fields?: Record<string, FirestoreValue> }>,
) {
  return docs
    .map((doc) => ({
      id: documentIdFromName(doc.name),
      rewardId: readString(doc.fields, "rewardId"),
      rewardDescription: readString(doc.fields, "rewardDescription"),
      rewardImageId: readString(doc.fields, "rewardImageId"),
      coinCost: Math.max(0, readInteger(doc.fields, "coinCost")),
      purchaserUid: readString(doc.fields, "purchaserUid"),
      purchaserName: readString(doc.fields, "purchaserName"),
      purchaserEmail: readString(doc.fields, "purchaserEmail"),
      purchasedAt: readTimestamp(doc.fields, "purchasedAt") || undefined,
      status: toClaimStatus(readString(doc.fields, "status")),
      claimedAt: readTimestamp(doc.fields, "claimedAt") || undefined,
      claimedByUid: readString(doc.fields, "claimedByUid") || undefined,
      claimedByName: readString(doc.fields, "claimedByName") || undefined,
      deleted: readBoolean(doc.fields, "deleted"),
    }))
    .filter(
      (claim) =>
        !claim.deleted &&
        Boolean(claim.id) &&
        Boolean(claim.rewardId) &&
        Boolean(claim.rewardDescription) &&
        Boolean(claim.rewardImageId) &&
        Boolean(claim.purchaserUid),
    )
    .sort((a, b) => {
      const byPurchasedAt = toUnixMillis(b.purchasedAt) - toUnixMillis(a.purchasedAt);
      if (byPurchasedAt !== 0) {
        return byPurchasedAt;
      }
      return b.id.localeCompare(a.id);
    })
    .map(({ deleted: _deleted, ...claim }) => claim);
}

export async function listFamilyAwardClaims(
  familyId: string,
  idToken: string,
  pageSize = 500,
) {
  const docs = await listDocuments(`families/${familyId}/awardClaims`, idToken, pageSize);
  return parseFamilyAwardClaims(docs);
}
