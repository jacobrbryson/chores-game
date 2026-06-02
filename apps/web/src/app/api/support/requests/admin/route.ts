import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { isSupportAdmin } from "@/lib/support/access";
import { adminCommitWrites, adminGetDocument } from "@/lib/firestore/admin";
import {
  boolField,
  readBoolean,
  stringField,
  timestampField,
  mapField,
  type FirestoreValue,
} from "@/lib/firestore/rest";
import {
  DEFAULT_SUPPORT_REQUEST_STATUS,
  validateSupportRequest,
  type SupportRequestInput,
} from "@/lib/support/requests";

export const runtime = "nodejs";

function jsonUnauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!isSupportAdmin(session)) {
    return NextResponse.json({ error: "support_admin_required" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;
  const familyId = typeof raw.familyId === "string" ? raw.familyId.trim() : "";
  const targetUid = typeof raw.targetUid === "string" ? raw.targetUid.trim() : "";
  const targetEmail = typeof raw.targetEmail === "string" ? raw.targetEmail.trim() : "";
  const targetDisplayName =
    typeof raw.targetDisplayName === "string" ? raw.targetDisplayName.trim() : "";
  const internalNote =
    typeof raw.internalNote === "string" ? raw.internalNote.trim().slice(0, 2000) : "";

  if (!familyId) {
    return NextResponse.json({ error: "family_id_required" }, { status: 400 });
  }
  if (!targetUid && !targetEmail) {
    return NextResponse.json({ error: "target_user_required" }, { status: 400 });
  }

  // Validate the request content fields.
  const requestInput: SupportRequestInput = {
    type: raw.type,
    subject: raw.subject,
    description: raw.description,
    severity: raw.severity,
    category: raw.category,
    pageUrl: raw.pageUrl ?? "",
  };
  const validation = validateSupportRequest(requestInput);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const input = validation.value;

  // Verify the family exists and is not deleted.
  try {
    const familyDoc = await adminGetDocument(`families/${familyId}`);
    if (readBoolean(familyDoc.fields, "deleted")) {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("FIRESTORE_ADMIN_HTTP_404")) {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    console.error("[ADMIN_SUPPORT_REQUEST_FAMILY_LOOKUP_ERROR]", reason.slice(0, 180));
    return NextResponse.json({ error: "family_lookup_failed" }, { status: 500 });
  }

  const supportRequestId = randomUUID();
  const now = new Date().toISOString();
  const tsPrefix = now.replace(/[^0-9]/g, "");
  const requestPath = `families/${familyId}/supportRequests/${supportRequestId}`;

  const requestFields: Record<string, FirestoreValue> = {
    id: stringField(supportRequestId),
    familyId: stringField(familyId),
    // Attribute the request to the target user — falls back to the admin's
    // own identity when no target UID is supplied (shouldn't happen after
    // the validation above, but keeps Firestore writes safe).
    createdByUid: stringField(targetUid),
    createdByMemberId: stringField(targetUid),
    createdByDisplayName: stringField(targetDisplayName),
    createdByEmail: stringField(targetEmail),
    type: stringField(input.type),
    subject: stringField(input.subject),
    description: stringField(input.description),
    ...(input.severity ? { severity: stringField(input.severity) } : {}),
    category: stringField(input.category),
    status: stringField(DEFAULT_SUPPORT_REQUEST_STATUS),
    appliedChangeLogDate: stringField(""),
    pageUrl: stringField(input.pageUrl),
    userAgent: stringField(""),
    createdAt: timestampField(now),
    updatedAt: timestampField(now),
    deleted: boolField(false),
    // Admin provenance — never shown to end users, used for audit purposes.
    adminCreated: boolField(true),
    adminCreatedByUid: stringField(session.uid),
    adminCreatedByEmail: stringField(session.email ?? ""),
  };

  const writes: Parameters<typeof adminCommitWrites>[0] = [
    { update: { path: requestPath, fields: requestFields } },
  ];

  // Attach the internal note as a history entry if provided.
  if (internalNote) {
    const historyId = `${tsPrefix}_${randomUUID()}`;
    writes.push({
      update: {
        path: `${requestPath}/history/${historyId}`,
        fields: {
          id: stringField(historyId),
          action: stringField("admin_created"),
          previousStatus: stringField(""),
          nextStatus: stringField(DEFAULT_SUPPORT_REQUEST_STATUS),
          note: stringField(internalNote),
          changedByUid: stringField(session.uid),
          changedByEmail: stringField(session.email ?? ""),
          createdAt: timestampField(now),
        },
      },
    });
  }

  // Write an audit log entry directly (bypasses the idToken-based helper).
  const auditId = `${tsPrefix}_${randomUUID()}`;
  writes.push({
    update: {
      path: `families/${familyId}/auditLogs/${auditId}`,
      fields: {
        familyId: stringField(familyId),
        eventType: stringField("support_request_created_by_admin"),
        actorUid: stringField(session.uid),
        actorEmail: stringField(session.email ?? ""),
        actorName: stringField(session.name ?? ""),
        actorRole: stringField("support"),
        userId: stringField(targetUid),
        choreId: stringField(""),
        choreTitle: stringField(""),
        source: stringField("support_admin"),
        reason: stringField(
          internalNote || `Admin created ${input.type} request on behalf of ${targetEmail || targetUid}`,
        ),
        requestId: stringField(supportRequestId),
        previousStatus: stringField(""),
        nextStatus: stringField(DEFAULT_SUPPORT_REQUEST_STATUS),
        previous: mapField({}),
        next: mapField({
          status: stringField(DEFAULT_SUPPORT_REQUEST_STATUS),
          type: stringField(input.type),
        }),
        createdAt: timestampField(now),
      },
    },
  });

  try {
    await adminCommitWrites(writes);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.error("[ADMIN_SUPPORT_REQUEST_CREATE_ERROR]", reason.slice(0, 240));
    return NextResponse.json({ error: "create_support_request_failed" }, { status: 500 });
  }

  return NextResponse.json(
    { supportRequest: { id: supportRequestId, familyId } },
    { status: 201 },
  );
}
