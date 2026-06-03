import { adminCommitWrites, adminGetDocument, adminRunQuery } from "@/lib/firestore/admin";
import {
  COMMUNITY_AWARD_TARGET_TYPE,
  getCommunityAwardRecord,
} from "@/lib/community-awards";

import {
  documentIdFromName,
  integerField,
  nullField,
  readBoolean,
  readInteger,
  readString,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";

export const PUBLIC_SUPPORT_REQUEST_TARGET_TYPE = "public_support_request";
export const VOTE_TARGET_TYPES = [
  PUBLIC_SUPPORT_REQUEST_TARGET_TYPE,
  COMMUNITY_AWARD_TARGET_TYPE,
  "changelog_item",
  "shared_prize",
  "quest",
] as const;
export type VoteTargetType = (typeof VOTE_TARGET_TYPES)[number];

export type VoteResult =
  | {
      ok: true;
      targetType: VoteTargetType;
      targetId: string;
      upvoteCount: number;
      downvoteCount: number;
      score: number;
      viewerVote: 1 | null;
    }
  | { ok: false; error: "invalid_target_type" | "invalid_vote_value" | "target_not_found" };

export function isVoteTargetType(value: unknown): value is VoteTargetType {
  return typeof value === "string" && VOTE_TARGET_TYPES.includes(value as VoteTargetType);
}

export function isSupportedVoteTargetType(value: unknown): value is typeof PUBLIC_SUPPORT_REQUEST_TARGET_TYPE | typeof COMMUNITY_AWARD_TARGET_TYPE {
  return value === PUBLIC_SUPPORT_REQUEST_TARGET_TYPE || value === COMMUNITY_AWARD_TARGET_TYPE;
}

export function buildVoteId(targetType: VoteTargetType, targetId: string, uid: string) {
  return `${targetType}*${targetId}*${uid}`;
}

export function buildVoteAggregateId(targetType: VoteTargetType, targetId: string) {
  return `${targetType}_${targetId}`;
}

async function findPublicSupportRequest(targetId: string) {
  const docs = await adminRunQuery({
    from: [{ collectionId: "supportRequests", allDescendants: true }],
    where: {
      fieldFilter: {
        field: { fieldPath: "id" },
        op: "EQUAL",
        value: { stringValue: targetId },
      },
    },
    limit: 500,
  });
  const doc = docs.find(
    (entry) =>
      documentIdFromName(entry.name) === targetId &&
      readBoolean(entry.fields, "isPublic") &&
      !readBoolean(entry.fields, "deleted"),
  );
  if (!doc) {
    return null;
  }
  return {
    id: documentIdFromName(doc.name),
    familyId: readString(doc.fields, "familyId"),
  };
}

async function validateVisibleTarget(targetType: VoteTargetType, targetId: string) {
  if (targetType === COMMUNITY_AWARD_TARGET_TYPE) {
    const award = await getCommunityAwardRecord(targetId);
    return award?.status === "approved" ? { id: award.id, familyId: null } : null;
  }
  if (targetType === PUBLIC_SUPPORT_REQUEST_TARGET_TYPE) {
    return findPublicSupportRequest(targetId);
  }
  return null;
}

async function readVote(path: string) {
  try {
    return await adminGetDocument(path);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("FIRESTORE_ADMIN_HTTP_404")) {
      return null;
    }
    throw error;
  }
}

async function readAggregate(targetType: VoteTargetType, targetId: string) {
  try {
    const doc = await adminGetDocument(`voteAggregates/${buildVoteAggregateId(targetType, targetId)}`);
    return {
      upvoteCount: readInteger(doc.fields, "upvoteCount"),
      downvoteCount: readInteger(doc.fields, "downvoteCount"),
      score: readInteger(doc.fields, "score"),
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("FIRESTORE_ADMIN_HTTP_404")) {
      return { upvoteCount: 0, downvoteCount: 0, score: 0 };
    }
    throw error;
  }
}

export async function toggleVote(input: {
  targetType: unknown;
  targetId: unknown;
  value: unknown;
  uid: string;
  familyId?: string | null;
}): Promise<VoteResult> {
  if (!isVoteTargetType(input.targetType) || !isSupportedVoteTargetType(input.targetType)) {
    return { ok: false, error: "invalid_target_type" };
  }
  if (input.value !== 1) {
    return { ok: false, error: "invalid_vote_value" };
  }
  const targetId = typeof input.targetId === "string" ? input.targetId.trim() : "";
  if (!targetId) {
    return { ok: false, error: "target_not_found" };
  }

  const target = await validateVisibleTarget(input.targetType, targetId);
  if (!target) {
    return { ok: false, error: "target_not_found" };
  }

  const now = new Date().toISOString();
  const voteId = buildVoteId(input.targetType, targetId, input.uid);
  const votePath = `votes/${voteId}`;
  const aggregateId = buildVoteAggregateId(input.targetType, targetId);
  const aggregatePath = `voteAggregates/${aggregateId}`;
  const existingVote = await readVote(votePath);
  const aggregate = await readAggregate(input.targetType, targetId);

  if (existingVote && readInteger(existingVote.fields, "value") === 1) {
    const nextUpvotes = Math.max(0, aggregate.upvoteCount - 1);
    const writes: Parameters<typeof adminCommitWrites>[0] = [
      {
        delete: {
          path: votePath,
          currentDocument: existingVote.updateTime ? { updateTime: existingVote.updateTime } : undefined,
        },
      },
      {
        update: {
          path: aggregatePath,
          fields: {
            targetType: stringField(input.targetType),
            targetId: stringField(targetId),
            upvoteCount: integerField(nextUpvotes),
            downvoteCount: integerField(0),
            score: integerField(nextUpvotes),
            updatedAt: timestampField(now),
          },
        },
      },
    ];
    if (input.targetType === COMMUNITY_AWARD_TARGET_TYPE) {
      writes.push({
        update: {
          path: `communityAwards/${targetId}`,
          fields: {
            voteCount: integerField(nextUpvotes),
            updatedAt: timestampField(now),
          },
          updateMask: ["voteCount", "updatedAt"],
        },
      });
    }
    await adminCommitWrites(writes);
    return {
      ok: true,
      targetType: input.targetType,
      targetId,
      upvoteCount: nextUpvotes,
      downvoteCount: 0,
      score: nextUpvotes,
      viewerVote: null,
    };
  }

  const nextUpvotes = aggregate.upvoteCount + 1;
  const writes: Parameters<typeof adminCommitWrites>[0] = [
    {
      update: {
        path: votePath,
        fields: {
          id: stringField(voteId),
          targetType: stringField(input.targetType),
          targetId: stringField(targetId),
          uid: stringField(input.uid),
          familyId: input.familyId ? stringField(input.familyId) : nullField(),
          value: integerField(1),
          createdAt: timestampField(existingVote ? readString(existingVote.fields, "createdAt") || now : now),
          updatedAt: timestampField(now),
        },
      },
    },
    {
      update: {
        path: aggregatePath,
        fields: {
          targetType: stringField(input.targetType),
          targetId: stringField(targetId),
          upvoteCount: integerField(nextUpvotes),
          downvoteCount: integerField(0),
          score: integerField(nextUpvotes),
          updatedAt: timestampField(now),
        },
      },
    },
  ];
  if (input.targetType === COMMUNITY_AWARD_TARGET_TYPE) {
    writes.push({
      update: {
        path: `communityAwards/${targetId}`,
        fields: {
          voteCount: integerField(nextUpvotes),
          updatedAt: timestampField(now),
        },
        updateMask: ["voteCount", "updatedAt"],
      },
    });
  }
  await adminCommitWrites(writes);

  return {
    ok: true,
    targetType: input.targetType,
    targetId,
    upvoteCount: nextUpvotes,
    downvoteCount: 0,
    score: nextUpvotes,
    viewerVote: 1,
  };
}
