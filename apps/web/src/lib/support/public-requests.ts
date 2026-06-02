import { adminGetDocument } from "@/lib/firestore/admin";
import { readInteger } from "@/lib/firestore/rest";
import {
  isPublicSupportRequestStatus,
  type PublicSupportRequestStatus,
  type SupportRequestType,
} from "@/lib/support/requests";
import {
  PUBLIC_SUPPORT_REQUEST_TARGET_TYPE,
  buildVoteId,
  type VoteTargetType,
} from "@/lib/voting/service";

export type PublicRequestedChange = {
  id: string;
  targetType: VoteTargetType;
  targetId: string;
  type: SupportRequestType;
  category: string;
  publicTitle: string;
  publicDescription: string;
  publicStatus: PublicSupportRequestStatus;
  publicPublishedAt: string;
  publicUpdatedAt: string;
  upvoteCount: number;
  downvoteCount: number;
  score: number;
  viewerVote: 1 | null;
  canVote: boolean;
};

export type RequestedChangeQuery = {
  page?: number;
  limit?: number;
  status?: string;
  type?: string;
  sort?: string;
  viewerUid?: string;
};

type RequestedChangeJsonItem = Partial<
  Pick<
    PublicRequestedChange,
    | "id"
    | "targetId"
    | "targetType"
    | "type"
    | "category"
    | "publicTitle"
    | "publicDescription"
    | "publicStatus"
    | "publicPublishedAt"
    | "publicUpdatedAt"
    | "upvoteCount"
    | "downvoteCount"
    | "score"
  >
>;

const MAX_PAGE_SIZE = 50;
export const DEFAULT_PUBLIC_REQUESTED_CHANGES_BUCKET = "assets-family-chores";
export const DEFAULT_PUBLIC_REQUESTED_CHANGES_OBJECT_PATH = "change-log/requested-changes.json";

export function requestedChangesObjectPath() {
  return (
    process.env.PUBLIC_REQUESTED_CHANGES_OBJECT_PATH?.trim() ||
    DEFAULT_PUBLIC_REQUESTED_CHANGES_OBJECT_PATH
  ).replace(/^\/+/, "");
}

export function requestedChangesBucket() {
  return (
    process.env.PUBLIC_REQUESTED_CHANGES_BUCKET?.trim() ||
    DEFAULT_PUBLIC_REQUESTED_CHANGES_BUCKET
  );
}

function requestedChangesUrl() {
  const objectPath = requestedChangesObjectPath();
  const baseUrl = process.env.NEXT_PUBLIC_GCS_ASSET_BASE_URL?.replace(/\/+$/, "");
  if (baseUrl) {
    return `${baseUrl}/${objectPath}`;
  }
  return `https://storage.googleapis.com/${requestedChangesBucket()}/${objectPath}`;
}

function isSupportRequestType(value: unknown): value is SupportRequestType {
  return value === "bug" || value === "feature";
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeJsonItem(item: RequestedChangeJsonItem): PublicRequestedChange | null {
  const id = stringValue(item.id || item.targetId);
  const publicTitle = stringValue(item.publicTitle);
  const publicDescription = stringValue(item.publicDescription);
  const type = isSupportRequestType(item.type) ? item.type : null;
  const publicStatus = isPublicSupportRequestStatus(item.publicStatus)
    ? item.publicStatus
    : "under_review";
  if (!id || !type || !publicTitle || !publicDescription) {
    return null;
  }

  const upvoteCount = positiveInteger(item.upvoteCount);
  const downvoteCount = positiveInteger(item.downvoteCount);
  const score =
    typeof item.score === "number" && Number.isFinite(item.score)
      ? Math.floor(item.score)
      : upvoteCount - downvoteCount;

  return {
    id,
    targetType: PUBLIC_SUPPORT_REQUEST_TARGET_TYPE,
    targetId: id,
    type,
    category: stringValue(item.category),
    publicTitle,
    publicDescription,
    publicStatus,
    publicPublishedAt: stringValue(item.publicPublishedAt),
    publicUpdatedAt: stringValue(item.publicUpdatedAt),
    upvoteCount,
    downvoteCount,
    score,
    viewerVote: null,
    canVote: false,
  };
}

async function loadRequestedChangesJson() {
  const response = await fetch(requestedChangesUrl(), {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    return [];
  }
  const json = (await response.json()) as unknown;
  const items = Array.isArray(json)
    ? json
    : json && typeof json === "object" && Array.isArray((json as { requests?: unknown }).requests)
      ? (json as { requests: unknown[] }).requests
      : [];
  return items
    .map((item) => normalizeJsonItem(item as RequestedChangeJsonItem))
    .filter((item): item is PublicRequestedChange => Boolean(item));
}

async function loadViewerVote(
  targetType: VoteTargetType,
  targetId: string,
  viewerUid: string,
): Promise<1 | null> {
  if (!viewerUid) {
    return null;
  }
  try {
    const vote = await adminGetDocument(`votes/${buildVoteId(targetType, targetId, viewerUid)}`);
    return readInteger(vote.fields, "value") === 1 ? 1 : null;
  } catch {
    return null;
  }
}

function compareRequestedChanges(
  left: PublicRequestedChange,
  right: PublicRequestedChange,
  sort: string,
) {
  if (sort === "most_voted") {
    return right.score - left.score || right.upvoteCount - left.upvoteCount || right.publicPublishedAt.localeCompare(left.publicPublishedAt);
  }
  return right.publicPublishedAt.localeCompare(left.publicPublishedAt);
}

export async function loadPublicRequestedChanges(query: RequestedChangeQuery) {
  const source = await loadRequestedChangesJson().catch((error) => {
    const reason = error instanceof Error ? error.message : "unknown";
    console.warn("[PUBLIC_REQUESTED_CHANGES_JSON_UNAVAILABLE]", reason.slice(0, 180));
    return [];
  });

  const filtered = source
    .filter((request) => !query.status || query.status === "all" || request.publicStatus === query.status)
    .filter((request) => !query.type || query.type === "all" || request.type === query.type);

  const withViewerVotes = await Promise.all(
    filtered.map(async (request) => ({
      ...request,
      viewerVote: await loadViewerVote(request.targetType, request.targetId, query.viewerUid ?? ""),
      canVote: Boolean(query.viewerUid),
    })),
  );

  const sorted = withViewerVotes.sort((left, right) => compareRequestedChanges(left, right, query.sort ?? "newest"));
  const pageSize = Math.min(Math.max(1, query.limit ?? 20), MAX_PAGE_SIZE);
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, query.page ?? 1), totalPages);
  const start = (page - 1) * pageSize;

  return {
    requests: sorted.slice(start, start + pageSize),
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
    },
  };
}
