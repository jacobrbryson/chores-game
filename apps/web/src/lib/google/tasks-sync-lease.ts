import { randomUUID } from "node:crypto";
import {
  commitWrites,
  getDocument,
  readString,
  readTimestamp,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";

const SYNC_LEASE_MILLIS = 10 * 60 * 1000;

function isPreconditionFailure(error: unknown) {
  const reason = error instanceof Error ? error.message : "";
  return reason.includes("FAILED_PRECONDITION") || reason.includes("ABORTED");
}

/**
 * Serializes a user's sync across app instances. Without this lease, two
 * requests can both observe an unmapped chore, create it in Google Tasks, and
 * only then race to persist different googleTaskId values.
 */
export async function acquireGoogleTasksSyncLease(input: {
  uid: string;
  idToken: string;
  now?: Date;
}): Promise<string | null> {
  const now = input.now ?? new Date();
  const userDoc = await getDocument(`users/${input.uid}`, input.idToken);
  const currentLeaseId = readString(userDoc.fields, "googleTasksSyncLeaseId");
  const currentExpiry = Date.parse(
    readTimestamp(userDoc.fields, "googleTasksSyncLeaseExpiresAt") || "",
  );
  if (currentLeaseId && Number.isFinite(currentExpiry) && currentExpiry > now.getTime()) {
    return null;
  }

  const leaseId = randomUUID();
  try {
    await commitWrites(
      [
        {
          update: {
            path: `users/${input.uid}`,
            fields: {
              googleTasksSyncLeaseId: stringField(leaseId),
              googleTasksSyncLeaseExpiresAt: timestampField(
                new Date(now.getTime() + SYNC_LEASE_MILLIS).toISOString(),
              ),
            },
            updateMask: ["googleTasksSyncLeaseId", "googleTasksSyncLeaseExpiresAt"],
            currentDocument: userDoc.updateTime
              ? { updateTime: userDoc.updateTime }
              : { exists: true },
          },
        },
      ],
      input.idToken,
    );
    return leaseId;
  } catch (error) {
    // A competing request won the compare-and-set. It will perform this sync.
    if (isPreconditionFailure(error)) {
      return null;
    }
    throw error;
  }
}

export async function releaseGoogleTasksSyncLease(input: {
  uid: string;
  idToken: string;
  leaseId: string;
  now?: Date;
}) {
  try {
    const userDoc = await getDocument(`users/${input.uid}`, input.idToken);
    if (readString(userDoc.fields, "googleTasksSyncLeaseId") !== input.leaseId) {
      return;
    }
    const now = input.now ?? new Date();
    await commitWrites(
      [
        {
          update: {
            path: `users/${input.uid}`,
            fields: {
              googleTasksSyncLeaseId: stringField(""),
              googleTasksSyncLeaseExpiresAt: timestampField(now.toISOString()),
            },
            updateMask: ["googleTasksSyncLeaseId", "googleTasksSyncLeaseExpiresAt"],
            currentDocument: userDoc.updateTime
              ? { updateTime: userDoc.updateTime }
              : { exists: true },
          },
        },
      ],
      input.idToken,
    );
  } catch (error) {
    // Expiry makes release best-effort. Never replace the sync result with a
    // cleanup error, and never clear a newer owner's lease.
    if (!isPreconditionFailure(error)) {
      console.error("[GOOGLE_TASKS_SYNC_LEASE_RELEASE_ERROR]", {
        uid: input.uid,
        reason: error instanceof Error ? error.message.slice(0, 180) : "unknown",
      });
    }
  }
}
