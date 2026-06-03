import { randomUUID } from "node:crypto";
import {
  adminCommitWrites,
  adminGetDocument,
  adminListDocuments,
  adminPatchDocument,
} from "@/lib/firestore/admin";
import {
  boolField,
  documentIdFromName,
  integerField,
  nullField,
  readBoolean,
  readInteger,
  readString,
  readStringArray,
  readTimestamp,
  stringArrayField,
  stringField,
  timestampField,
  type FirestoreDocument,
  type FirestoreValue,
} from "@/lib/firestore/rest";
import {
  FAMILY_REWARD_IMAGE_OPTIONS,
  findFamilyRewardImageOption,
  isFamilyRewardImageId,
  normalizeFamilyRewardCoinCost,
  normalizeFamilyRewardDescription,
  normalizeFamilyRewardImageId,
} from "@/lib/family/rewards";

export const COMMUNITY_AWARD_TARGET_TYPE = "community_award";

export const COMMUNITY_AWARD_STATUSES = [
  "draft",
  "pending_review",
  "approved",
  "rejected",
  "hidden",
  "withdrawn",
] as const;

export type CommunityAwardStatus = (typeof COMMUNITY_AWARD_STATUSES)[number];

export type CommunityAwardRecord = {
  id: string;
  sourceFamilyId: string;
  sourceRewardId: string;
  sourceSubmittedByUid: string;
  sourceTitle: string;
  sourceDescription: string;
  sourceCoinAmount: number;
  sourceImage: string;
  sourceCreatedAt: string;
  publicTitle: string;
  publicDescription: string;
  publicCoinAmount: number;
  publicImage: string;
  publicImagePath: string;
  publicCategory: string;
  publicTags: string[];
  status: CommunityAwardStatus;
  rejectionReason: string;
  internalModerationNotes: string;
  reviewedByUid: string;
  reviewedByEmail: string;
  reviewedAt: string;
  approvedAt: string;
  hiddenAt: string;
  createdAt: string;
  updatedAt: string;
  voteCount: number;
  copyCount: number;
};

export type PublicCommunityAward = Pick<
  CommunityAwardRecord,
  | "id"
  | "publicTitle"
  | "publicDescription"
  | "publicCoinAmount"
  | "publicImage"
  | "publicImagePath"
  | "publicCategory"
  | "publicTags"
  | "voteCount"
  | "copyCount"
  | "approvedAt"
  | "createdAt"
> & { viewerVote: 1 | null };

export function isCommunityAwardStatus(value: unknown): value is CommunityAwardStatus {
  return typeof value === "string" && COMMUNITY_AWARD_STATUSES.includes(value as CommunityAwardStatus);
}

export function normalizeCommunityAwardStatus(value: string): CommunityAwardStatus {
  return isCommunityAwardStatus(value) ? value : "pending_review";
}

export function normalizeCommunityAwardText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

export function normalizeCommunityAwardTags(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeCommunityAwardText(entry, 32).toLowerCase())
      .filter(Boolean)
      .slice(0, 8);
  }
  if (typeof value !== "string") {
    return [];
  }
  return value
    .split(",")
    .map((entry) => normalizeCommunityAwardText(entry, 32).toLowerCase())
    .filter(Boolean)
    .slice(0, 8);
}

export function normalizeCommunityAwardImage(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (isFamilyRewardImageId(raw)) {
    return raw;
  }
  const byPath = FAMILY_REWARD_IMAGE_OPTIONS.find((entry) => entry.imagePath === raw);
  return byPath?.id ?? normalizeFamilyRewardImageId("");
}

export function parseCommunityAward(doc: FirestoreDocument): CommunityAwardRecord {
  const id = documentIdFromName(doc.name);
  const publicImage = normalizeCommunityAwardImage(readString(doc.fields, "publicImage"));
  return {
    id,
    sourceFamilyId: readString(doc.fields, "sourceFamilyId"),
    sourceRewardId: readString(doc.fields, "sourceRewardId"),
    sourceSubmittedByUid: readString(doc.fields, "sourceSubmittedByUid"),
    sourceTitle: readString(doc.fields, "sourceTitle"),
    sourceDescription: readString(doc.fields, "sourceDescription"),
    sourceCoinAmount: readInteger(doc.fields, "sourceCoinAmount"),
    sourceImage: normalizeCommunityAwardImage(readString(doc.fields, "sourceImage")),
    sourceCreatedAt: readTimestamp(doc.fields, "sourceCreatedAt"),
    publicTitle: readString(doc.fields, "publicTitle"),
    publicDescription: readString(doc.fields, "publicDescription"),
    publicCoinAmount: readInteger(doc.fields, "publicCoinAmount"),
    publicImage,
    publicImagePath: findFamilyRewardImageOption(publicImage)?.imagePath ?? "/rewards/screens.png",
    publicCategory: readString(doc.fields, "publicCategory"),
    publicTags: readStringArray(doc.fields, "publicTags"),
    status: normalizeCommunityAwardStatus(readString(doc.fields, "status")),
    rejectionReason: readString(doc.fields, "rejectionReason"),
    internalModerationNotes: readString(doc.fields, "internalModerationNotes"),
    reviewedByUid: readString(doc.fields, "reviewedByUid"),
    reviewedByEmail: readString(doc.fields, "reviewedByEmail"),
    reviewedAt: readTimestamp(doc.fields, "reviewedAt"),
    approvedAt: readTimestamp(doc.fields, "approvedAt"),
    hiddenAt: readTimestamp(doc.fields, "hiddenAt"),
    createdAt: readTimestamp(doc.fields, "createdAt"),
    updatedAt: readTimestamp(doc.fields, "updatedAt"),
    voteCount: readInteger(doc.fields, "voteCount"),
    copyCount: readInteger(doc.fields, "copyCount"),
  };
}

export function toPublicCommunityAward(record: CommunityAwardRecord, viewerVote: 1 | null): PublicCommunityAward {
  return {
    id: record.id,
    publicTitle: record.publicTitle,
    publicDescription: record.publicDescription,
    publicCoinAmount: record.publicCoinAmount,
    publicImage: record.publicImage,
    publicImagePath: record.publicImagePath,
    publicCategory: record.publicCategory,
    publicTags: record.publicTags,
    voteCount: record.voteCount,
    copyCount: record.copyCount,
    approvedAt: record.approvedAt,
    createdAt: record.createdAt,
    viewerVote,
  };
}

export async function listCommunityAwardRecords() {
  const docs = await adminListDocuments("communityAwards", 500);
  return docs.map(parseCommunityAward);
}

export async function getCommunityAwardRecord(id: string) {
  try {
    return parseCommunityAward(await adminGetDocument(`communityAwards/${id}`));
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("FIRESTORE_ADMIN_HTTP_404")) {
      return null;
    }
    throw error;
  }
}

export async function readViewerVote(targetId: string, uid: string) {
  try {
    const doc = await adminGetDocument(`votes/${COMMUNITY_AWARD_TARGET_TYPE}*${targetId}*${uid}`);
    return readInteger(doc.fields, "value") === 1 ? 1 : null;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("FIRESTORE_ADMIN_HTTP_404")) {
      return null;
    }
    throw error;
  }
}

export function filterAndSortPublicCommunityAwards(
  records: CommunityAwardRecord[],
  options: { search?: string; sort?: string },
) {
  const query = (options.search ?? "").trim().toLowerCase();
  const filtered = records
    .filter((record) => record.status === "approved")
    .filter((record) => {
      if (!query) {
        return true;
      }
      return [
        record.publicTitle,
        record.publicDescription,
        record.publicCategory,
        record.publicTags.join(" "),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });

  return [...filtered].sort((a, b) => {
    if (options.sort === "most_copied") {
      return b.copyCount - a.copyCount || newestFirst(a, b);
    }
    if (options.sort === "newest") {
      return newestFirst(a, b);
    }
    return b.voteCount - a.voteCount || newestFirst(a, b);
  });
}

function newestFirst(a: CommunityAwardRecord, b: CommunityAwardRecord) {
  return (Date.parse(b.approvedAt || b.createdAt) || 0) - (Date.parse(a.approvedAt || a.createdAt) || 0);
}

function auditFields(input: {
  eventType: string;
  familyId: string;
  actorUid: string;
  actorEmail?: string;
  reason: string;
  source?: string;
  requestId?: string;
}) {
  return {
    familyId: stringField(input.familyId),
    eventType: stringField(input.eventType),
    actorUid: stringField(input.actorUid),
    actorEmail: stringField(input.actorEmail ?? ""),
    actorName: stringField(""),
    actorRole: stringField(input.source === "support_admin" ? "support" : "admin"),
    userId: stringField(""),
    choreId: stringField(""),
    choreTitle: stringField(""),
    source: stringField(input.source ?? "community_awards"),
    reason: stringField(input.reason),
    requestId: stringField(input.requestId ?? ""),
    previous: { mapValue: { fields: {} } },
    next: { mapValue: { fields: {} } },
    createdAt: timestampField(new Date().toISOString()),
  };
}

export async function submitFamilyRewardToCommunity(input: {
  familyId: string;
  rewardId: string;
  submittedByUid: string;
  submittedByEmail?: string;
  description: string;
  coinCost: number;
  imageId: string;
  existingSubmissionId?: string;
  existingStatus?: string;
  rewardCreatedAt?: string;
}) {
  const now = new Date().toISOString();
  const existingStatus = normalizeCommunityAwardStatus(input.existingStatus ?? "");
  const reusable =
    input.existingSubmissionId &&
    (existingStatus === "pending_review" || existingStatus === "rejected" || existingStatus === "withdrawn");
  const submissionId = reusable ? input.existingSubmissionId ?? randomUUID() : randomUUID();
  const sourceDescription = normalizeFamilyRewardDescription(input.description);
  const imageId = normalizeCommunityAwardImage(input.imageId);

  await adminCommitWrites([
    {
      update: {
        path: `communityAwards/${submissionId}`,
        fields: {
          id: stringField(submissionId),
          sourceFamilyId: stringField(input.familyId),
          sourceRewardId: stringField(input.rewardId),
          sourceSubmittedByUid: stringField(input.submittedByUid),
          sourceTitle: stringField(sourceDescription),
          sourceDescription: stringField(sourceDescription),
          sourceCoinAmount: integerField(input.coinCost),
          sourceImage: stringField(imageId),
          sourceCreatedAt: timestampField(input.rewardCreatedAt || now),
          publicTitle: stringField(sourceDescription),
          publicDescription: stringField(sourceDescription),
          publicCoinAmount: integerField(input.coinCost),
          publicImage: stringField(imageId),
          publicCategory: stringField("family"),
          publicTags: stringArrayField([]),
          status: stringField("pending_review"),
          rejectionReason: stringField(""),
          internalModerationNotes: stringField(""),
          reviewedByUid: stringField(""),
          reviewedByEmail: stringField(""),
          reviewedAt: nullField(),
          approvedAt: nullField(),
          hiddenAt: nullField(),
          createdAt: timestampField(reusable ? now : now),
          updatedAt: timestampField(now),
          voteCount: integerField(0),
          copyCount: integerField(0),
        },
      },
    },
    {
      update: {
        path: `families/${input.familyId}/rewards/${input.rewardId}`,
        fields: {
          submitToCommunityAwards: boolField(true),
          communityAwardSubmissionId: stringField(submissionId),
          communityAwardSubmissionStatus: stringField("pending_review"),
          communityAwardSubmittedAt: timestampField(now),
          communityAwardReviewedAt: nullField(),
          updatedAt: timestampField(now),
        },
        updateMask: [
          "submitToCommunityAwards",
          "communityAwardSubmissionId",
          "communityAwardSubmissionStatus",
          "communityAwardSubmittedAt",
          "communityAwardReviewedAt",
          "updatedAt",
        ],
      },
    },
    {
      update: {
        path: `families/${input.familyId}/auditLogs/${randomUUID()}`,
        fields: auditFields({
          eventType: "community_award_submitted",
          familyId: input.familyId,
          actorUid: input.submittedByUid,
          actorEmail: input.submittedByEmail,
          reason: `Submitted family award ${input.rewardId} for community review.`,
          requestId: submissionId,
        }),
      },
    },
  ]);

  return submissionId;
}

export async function withdrawFamilyRewardCommunitySubmission(input: {
  familyId: string;
  rewardId: string;
  actorUid: string;
  actorEmail?: string;
  submissionId?: string;
  existingStatus?: string;
}) {
  const now = new Date().toISOString();
  const status = normalizeCommunityAwardStatus(input.existingStatus ?? "");
  const canWithdraw = Boolean(input.submissionId) && status !== "approved" && status !== "hidden";
  const writes: Parameters<typeof adminCommitWrites>[0] = [
    {
      update: {
        path: `families/${input.familyId}/rewards/${input.rewardId}`,
        fields: {
          submitToCommunityAwards: boolField(false),
          communityAwardSubmissionStatus: stringField(canWithdraw ? "withdrawn" : status || ""),
          communityAwardReviewedAt: nullField(),
          updatedAt: timestampField(now),
        },
        updateMask: [
          "submitToCommunityAwards",
          "communityAwardSubmissionStatus",
          "communityAwardReviewedAt",
          "updatedAt",
        ],
      },
    },
  ];

  if (canWithdraw && input.submissionId) {
    writes.push({
      update: {
        path: `communityAwards/${input.submissionId}`,
        fields: {
          status: stringField("withdrawn"),
          updatedAt: timestampField(now),
        },
        updateMask: ["status", "updatedAt"],
      },
    });
  }

  writes.push({
    update: {
      path: `families/${input.familyId}/auditLogs/${randomUUID()}`,
      fields: auditFields({
        eventType: "community_award_withdrawn",
        familyId: input.familyId,
        actorUid: input.actorUid,
        actorEmail: input.actorEmail,
        reason: `Withdrew family award ${input.rewardId} from community review.`,
        requestId: input.submissionId ?? "",
      }),
    },
  });

  await adminCommitWrites(writes);
}

export async function syncFamilyRewardSubmissionStatus(input: {
  familyId: string;
  rewardId: string;
  submissionId: string;
  status: CommunityAwardStatus;
  reviewedAt?: string;
  rejectionReason?: string;
}) {
  await adminPatchDocument(
    `families/${input.familyId}/rewards/${input.rewardId}`,
    {
      communityAwardSubmissionStatus: stringField(input.status),
      communityAwardReviewedAt: input.reviewedAt ? timestampField(input.reviewedAt) : nullField(),
      communityAwardRejectionReason: stringField(input.rejectionReason ?? ""),
      updatedAt: timestampField(new Date().toISOString()),
    },
    ["communityAwardSubmissionStatus", "communityAwardReviewedAt", "communityAwardRejectionReason", "updatedAt"],
  );
}

export function communityAwardEditableFields(input: Record<string, unknown>) {
  const publicTitle = normalizeCommunityAwardText(input.publicTitle, 120);
  const publicDescription = normalizeCommunityAwardText(input.publicDescription, 500);
  const publicCoinAmount = normalizeFamilyRewardCoinCost(input.publicCoinAmount);
  const publicImage = normalizeCommunityAwardImage(input.publicImage ?? input.publicImageId);
  const publicCategory = normalizeCommunityAwardText(input.publicCategory, 48) || "family";
  const publicTags = normalizeCommunityAwardTags(input.publicTags);
  const rejectionReason = normalizeCommunityAwardText(input.rejectionReason, 500);
  const internalModerationNotes = normalizeCommunityAwardText(input.internalModerationNotes, 2000);
  return {
    publicTitle,
    publicDescription,
    publicCoinAmount,
    publicImage,
    publicCategory,
    publicTags,
    rejectionReason,
    internalModerationNotes,
  };
}

export function editableCommunityAwardFirestoreFields(fields: ReturnType<typeof communityAwardEditableFields>) {
  return {
    publicTitle: stringField(fields.publicTitle),
    publicDescription: stringField(fields.publicDescription),
    publicCoinAmount: integerField(fields.publicCoinAmount),
    publicImage: stringField(fields.publicImage),
    publicCategory: stringField(fields.publicCategory),
    publicTags: stringArrayField(fields.publicTags),
    rejectionReason: stringField(fields.rejectionReason),
    internalModerationNotes: stringField(fields.internalModerationNotes),
  } satisfies Record<string, FirestoreValue>;
}
