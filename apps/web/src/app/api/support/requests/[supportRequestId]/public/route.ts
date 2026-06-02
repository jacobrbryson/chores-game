import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { adminCommitWrites, adminGetDocument } from "@/lib/firestore/admin";
import {
  boolField,
  mapField,
  readBoolean,
  readString,
  readTimestamp,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";
import { loadSupportRequestDetail } from "@/lib/support/management";
import {
  mapInternalStatusToPublicStatus,
  normalizeSupportRequestStatus,
  validatePublicSupportRequest,
  type PublicSupportRequestInput,
} from "@/lib/support/requests";
import { isSupportAdmin } from "@/lib/support/access";
import { writePublicRequestedChangesSnapshotBestEffort } from "@/lib/support/public-requests-snapshot";

type RouteContext = { params: Promise<{ supportRequestId: string }> };

export const runtime = "nodejs";

function containsPrivatePublicCopy(value: string, existingFields: Parameters<typeof readString>[0]) {
  const normalized = value.toLowerCase();
  const privateTokens = [
    readString(existingFields, "familyId"),
    readString(existingFields, "createdByUid"),
    readString(existingFields, "createdByEmail"),
    readString(existingFields, "createdByDisplayName"),
  ]
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length >= 3);

  return (
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value) ||
    privateTokens.some((token) => normalized.includes(token))
  );
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isSupportAdmin(session)) {
    return NextResponse.json({ error: "support_admin_required" }, { status: 403 });
  }

  const { supportRequestId } = await context.params;
  if (!supportRequestId) {
    return NextResponse.json({ error: "request_id_required" }, { status: 400 });
  }

  let body: PublicSupportRequestInput & { familyId?: unknown };
  try {
    body = (await request.json()) as PublicSupportRequestInput & { familyId?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const familyId = typeof body.familyId === "string" ? body.familyId.trim() : "";
  if (!familyId) {
    return NextResponse.json({ error: "family_id_required" }, { status: 400 });
  }

  const path = `families/${familyId}/supportRequests/${supportRequestId}`;
  let existingDoc;
  try {
    existingDoc = await adminGetDocument(path);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    if (reason.includes("FIRESTORE_ADMIN_HTTP_404")) {
      return NextResponse.json({ error: "support_request_not_found" }, { status: 404 });
    }
    throw error;
  }
  if (readBoolean(existingDoc.fields, "deleted")) {
    return NextResponse.json({ error: "support_request_not_found" }, { status: 404 });
  }

  const internalStatus = normalizeSupportRequestStatus(readString(existingDoc.fields, "status"));
  const validation = validatePublicSupportRequest({
    isPublic: body.isPublic,
    publicTitle: body.publicTitle,
    publicDescription: body.publicDescription,
    publicStatus: body.publicStatus || mapInternalStatusToPublicStatus(internalStatus),
  });
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  if (
    validation.value.isPublic &&
    (containsPrivatePublicCopy(validation.value.publicTitle, existingDoc.fields) ||
      containsPrivatePublicCopy(validation.value.publicDescription, existingDoc.fields))
  ) {
    return NextResponse.json({ error: "public_copy_contains_private_info" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const previousIsPublic = readBoolean(existingDoc.fields, "isPublic");
  const next = validation.value;
  const publishedAt =
    next.isPublic && !previousIsPublic
      ? now
      : readTimestamp(existingDoc.fields, "publicPublishedAt") || now;
  const historyId = `${now.replace(/[^0-9]/g, "")}_${randomUUID()}`;
  const auditId = `${now.replace(/[^0-9]/g, "")}_${randomUUID()}`;
  const action = next.isPublic ? (previousIsPublic ? "public_updated" : "published") : "unpublished";

  await adminCommitWrites([
    {
      update: {
        path,
        fields: {
          isPublic: boolField(next.isPublic),
          publicTitle: stringField(next.publicTitle),
          publicDescription: stringField(next.publicDescription),
          publicStatus: stringField(next.publicStatus),
          publicPublishedAt: timestampField(publishedAt),
          publicPublishedByUid: stringField(next.isPublic ? session.uid : readString(existingDoc.fields, "publicPublishedByUid")),
          publicUpdatedAt: timestampField(now),
          updatedAt: timestampField(now),
        },
        updateMask: [
          "isPublic",
          "publicTitle",
          "publicDescription",
          "publicStatus",
          "publicPublishedAt",
          "publicPublishedByUid",
          "publicUpdatedAt",
          "updatedAt",
        ],
      },
    },
    {
      update: {
        path: `families/${familyId}/supportRequests/${supportRequestId}/history/${historyId}`,
        fields: {
          id: stringField(historyId),
          action: stringField(action),
          previousStatus: stringField(readString(existingDoc.fields, "publicStatus")),
          nextStatus: stringField(next.publicStatus),
          note: stringField(""),
          changedByUid: stringField(session.uid),
          changedByEmail: stringField(session.email ?? ""),
          createdAt: timestampField(now),
        },
      },
    },
    {
      update: {
        path: `families/${familyId}/auditLogs/${auditId}`,
        fields: {
          familyId: stringField(familyId),
          eventType: stringField("support_request_public_visibility_changed"),
          actorUid: stringField(session.uid),
          actorEmail: stringField(session.email ?? ""),
          actorName: stringField(session.name ?? ""),
          actorRole: stringField("support"),
          userId: stringField(readString(existingDoc.fields, "createdByUid")),
          choreId: stringField(""),
          choreTitle: stringField(""),
          source: stringField("support_admin"),
          reason: stringField(action),
          requestId: stringField(supportRequestId),
          previousStatus: stringField(readString(existingDoc.fields, "publicStatus")),
          nextStatus: stringField(next.publicStatus),
          previous: mapField({
            isPublic: boolField(previousIsPublic),
            publicStatus: stringField(readString(existingDoc.fields, "publicStatus")),
          }),
          next: mapField({
            isPublic: boolField(next.isPublic),
            publicStatus: stringField(next.publicStatus),
          }),
          createdAt: timestampField(now),
        },
      },
    },
  ]);

  const detail = await loadSupportRequestDetail(familyId, supportRequestId);
  await writePublicRequestedChangesSnapshotBestEffort();
  return NextResponse.json({ request: detail.request, historyEntry: detail.history[0] ?? null });
}
