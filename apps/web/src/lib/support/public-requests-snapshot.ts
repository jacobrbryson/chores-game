import { adminGetDocument, adminRunQuery } from "@/lib/firestore/admin";
import {
  readBoolean,
  readInteger,
  readString,
  readTimestamp,
  type FirestoreDocument,
} from "@/lib/firestore/rest";
import { uploadGcsJsonToBucket } from "@/lib/gcs/storage";
import {
  isPublicSupportRequestStatus,
  mapInternalStatusToPublicStatus,
  normalizeSupportRequestStatus,
} from "@/lib/support/requests";
import {
  requestedChangesBucket,
  requestedChangesObjectPath,
} from "@/lib/support/public-requests";
import {
  PUBLIC_SUPPORT_REQUEST_TARGET_TYPE,
  buildVoteAggregateId,
} from "@/lib/voting/service";

const MAX_PUBLIC_REQUEST_SNAPSHOT_ROWS = 500;

function readPublicStatus(doc: FirestoreDocument) {
  const raw = readString(doc.fields, "publicStatus");
  if (isPublicSupportRequestStatus(raw)) {
    return raw;
  }
  return mapInternalStatusToPublicStatus(normalizeSupportRequestStatus(readString(doc.fields, "status")));
}

async function loadAggregate(targetId: string) {
  try {
    const aggregate = await adminGetDocument(
      `voteAggregates/${buildVoteAggregateId(PUBLIC_SUPPORT_REQUEST_TARGET_TYPE, targetId)}`,
    );
    return {
      upvoteCount: readInteger(aggregate.fields, "upvoteCount"),
      downvoteCount: readInteger(aggregate.fields, "downvoteCount"),
      score: readInteger(aggregate.fields, "score"),
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("FIRESTORE_ADMIN_HTTP_404")) {
      return { upvoteCount: 0, downvoteCount: 0, score: 0 };
    }
    throw error;
  }
}

export async function writePublicRequestedChangesSnapshot() {
  const docs = await adminRunQuery({
    from: [{ collectionId: "supportRequests", allDescendants: true }],
    limit: MAX_PUBLIC_REQUEST_SNAPSHOT_ROWS,
  });

  const rows = await Promise.all(
    docs
      .filter((doc) => readBoolean(doc.fields, "isPublic") && !readBoolean(doc.fields, "deleted"))
      .map(async (doc) => {
        const id = readString(doc.fields, "id");
        const type = readString(doc.fields, "type") === "feature" ? "feature" : "bug";
        const publicTitle = readString(doc.fields, "publicTitle");
        const publicDescription = readString(doc.fields, "publicDescription");
        if (!id || !publicTitle || !publicDescription) {
          return null;
        }
        return {
          id,
          targetType: PUBLIC_SUPPORT_REQUEST_TARGET_TYPE,
          targetId: id,
          type,
          category: readString(doc.fields, "category"),
          publicTitle,
          publicDescription,
          publicStatus: readPublicStatus(doc),
          publicPublishedAt: readTimestamp(doc.fields, "publicPublishedAt"),
          publicUpdatedAt: readTimestamp(doc.fields, "publicUpdatedAt"),
          ...(await loadAggregate(id)),
        };
      }),
  );

  const requests = rows
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .sort((left, right) => right.publicPublishedAt.localeCompare(left.publicPublishedAt));

  await uploadGcsJsonToBucket(requestedChangesBucket(), requestedChangesObjectPath(), {
    updatedAt: new Date().toISOString(),
    requests,
  });
}

export async function writePublicRequestedChangesSnapshotBestEffort() {
  try {
    await writePublicRequestedChangesSnapshot();
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.warn("[PUBLIC_REQUESTED_CHANGES_SNAPSHOT_SKIPPED]", reason.slice(0, 180));
  }
}

