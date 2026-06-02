import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import { isSupportAdmin } from "@/lib/support/access";
import {
  adminCommitWrites,
  adminGetDocument,
} from "@/lib/firestore/admin";
import {
  boolField,
  findFirstFamilyIdByMemberUid,
  getDocument,
  mapField,
  patchDocument,
  readBoolean,
  readString,
  readStringArray,
  stringField,
  timestampField,
  type FirestoreValue,
} from "@/lib/firestore/rest";
import { loadSupportRequestDetail } from "@/lib/support/management";
import {
  normalizeSupportRequestStatus,
  SUPPORT_REQUEST_STATUSES,
  validateSupportRequest,
  type SupportRequestInput,
  type SupportRequestStatus,
  type SupportRequestType,
} from "@/lib/support/requests";

type RouteContext = { params: Promise<{ supportRequestId: string }> };
type OperatorPatchBody = { familyId?: unknown; status?: unknown; note?: unknown; category?: unknown };

function jsonUnauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

function jsonReauthRequired() {
  return NextResponse.json(
    { error: "reauth_required", message: "Please sign out and sign in again to refresh your session." },
    { status: 401 },
  );
}

function mapCommonFirestoreErrors(reason: string, fallbackError: string) {
  if (reason.includes("FIRESTORE_HTTP_401") || reason.includes("FIREBASE_REFRESH_FAILED")) {
    return jsonReauthRequired();
  }
  if (reason.includes("FIRESTORE_HTTP_403")) {
    return NextResponse.json({ error: "firestore_forbidden" }, { status: 403 });
  }
  return NextResponse.json({ error: fallbackError }, { status: 500 });
}

async function getPrimaryFamilyId(uid: string, idToken: string) {
  let familyId = "";
  try {
    const userDoc = await getDocument(`users/${uid}`, idToken);
    familyId = readStringArray(userDoc.fields, "familyIds")[0] ?? "";
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (!reason.includes("FIRESTORE_HTTP_404")) {
      throw error;
    }
  }
  if (familyId) {
    return familyId;
  }
  return findFirstFamilyIdByMemberUid(uid, idToken);
}

async function loadOwnRequest(
  uid: string,
  supportRequestId: string,
  idToken: string,
  options: { requireOpen: boolean },
): Promise<
  | { kind: "ok"; path: string; type: SupportRequestType }
  | { kind: "family_not_found" }
  | { kind: "not_found" }
  | { kind: "not_editable" }
> {
  const familyId = await getPrimaryFamilyId(uid, idToken);
  if (!familyId) {
    return { kind: "family_not_found" };
  }
  const path = `families/${familyId}/supportRequests/${supportRequestId}`;
  let doc;
  try {
    doc = await getDocument(path, idToken);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("FIRESTORE_HTTP_404")) {
      return { kind: "not_found" };
    }
    throw error;
  }
  if (readString(doc.fields, "createdByUid") !== uid || readBoolean(doc.fields, "deleted")) {
    return { kind: "not_found" };
  }
  if (options.requireOpen && normalizeSupportRequestStatus(readString(doc.fields, "status")) !== "new") {
    return { kind: "not_editable" };
  }
  return {
    kind: "ok",
    path,
    type: readString(doc.fields, "type") === "feature" ? "feature" : "bug",
  };
}

function isSupportRequestStatus(value: unknown): value is SupportRequestStatus {
  return (
    typeof value === "string" &&
    SUPPORT_REQUEST_STATUSES.includes(value as SupportRequestStatus)
  );
}

function isOperatorPatchBody(body: unknown): body is OperatorPatchBody {
  if (!body || typeof body !== "object") {
    return false;
  }
  const candidate = body as Record<string, unknown>;
  return "status" in candidate || "familyId" in candidate || "note" in candidate;
}

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: RouteContext) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!isSupportAdmin(session)) {
    return NextResponse.json({ error: "support_admin_required" }, { status: 403 });
  }

  const { supportRequestId } = await context.params;
  const familyId = request.nextUrl.searchParams.get("familyId")?.trim() ?? "";
  if (!supportRequestId || !familyId) {
    return NextResponse.json({ error: "family_id_required" }, { status: 400 });
  }

  try {
    const detail = await loadSupportRequestDetail(familyId, supportRequestId);
    return NextResponse.json({ ...detail, statuses: SUPPORT_REQUEST_STATUSES });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    if (reason.includes("FIRESTORE_ADMIN_HTTP_404") || reason.includes("SUPPORT_REQUEST_DELETED")) {
      return NextResponse.json({ error: "support_request_not_found" }, { status: 404 });
    }
    console.error("[SUPPORT_REQUEST_DETAIL_ERROR]", reason.slice(0, 240));
    return NextResponse.json({ error: "support_request_unavailable" }, { status: 500 });
  }
}

async function patchOperatorRequest(
  request: NextRequest,
  supportRequestId: string,
  body: OperatorPatchBody,
) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!isSupportAdmin(session)) {
    return NextResponse.json({ error: "support_admin_required" }, { status: 403 });
  }

  const familyId = typeof body.familyId === "string" ? body.familyId.trim() : "";
  const status = body.status;
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : "";
  const category = typeof body.category === "string" ? body.category.trim().slice(0, 100) : undefined;
  if (!familyId) {
    return NextResponse.json({ error: "family_id_required" }, { status: 400 });
  }
  if (!isSupportRequestStatus(status)) {
    return NextResponse.json({ error: "invalid_status" }, { status: 400 });
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

  const previousStatus = normalizeSupportRequestStatus(readString(existingDoc.fields, "status"));
  const now = new Date().toISOString();
  const historyId = `${now.replace(/[^0-9]/g, "")}_${randomUUID()}`;
  const auditId = `${now.replace(/[^0-9]/g, "")}_${randomUUID()}`;

  const updateFields: Record<string, FirestoreValue> = {
    status: stringField(status),
    updatedAt: timestampField(now),
  };
  const updateMask = ["status", "updatedAt"];
  if (category !== undefined) {
    updateFields.category = stringField(category);
    updateMask.push("category");
  }

  await adminCommitWrites([
    {
      update: {
        path,
        fields: updateFields,
        updateMask,
      },
    },
    {
      update: {
        path: `families/${familyId}/supportRequests/${supportRequestId}/history/${historyId}`,
        fields: {
          id: stringField(historyId),
          action: stringField("status_changed"),
          previousStatus: stringField(previousStatus),
          nextStatus: stringField(status),
          note: stringField(note),
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
          eventType: stringField("support_request_status_changed"),
          actorUid: stringField(session.uid),
          actorEmail: stringField(session.email ?? ""),
          actorName: stringField(session.name ?? ""),
          actorRole: stringField("support"),
          userId: stringField(readString(existingDoc.fields, "createdByUid")),
          choreId: stringField(""),
          choreTitle: stringField(""),
          source: stringField("support_admin"),
          reason: stringField(note || `status:${previousStatus}->${status}`),
          requestId: stringField(supportRequestId),
          previousStatus: stringField(previousStatus),
          nextStatus: stringField(status),
          previous: mapField({ status: stringField(previousStatus) }),
          next: mapField({ status: stringField(status) }),
          createdAt: timestampField(now),
        },
      },
    },
  ]);

  const detail = await loadSupportRequestDetail(familyId, supportRequestId);
  return NextResponse.json({
    request: detail.request,
    historyEntry: detail.history[0] ?? null,
  });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { supportRequestId } = await context.params;
  if (!supportRequestId) {
    return NextResponse.json({ error: "request_id_required" }, { status: 400 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (isOperatorPatchBody(rawBody)) {
    try {
      return await patchOperatorRequest(request, supportRequestId, rawBody);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown";
      console.error("[SUPPORT_REQUEST_STATUS_PATCH_ERROR]", reason.slice(0, 240));
      if (reason.includes("FIRESTORE_ADMIN_HTTP_404")) {
        return NextResponse.json({ error: "support_request_not_found" }, { status: 404 });
      }
      return NextResponse.json({ error: "update_support_request_failed" }, { status: 500 });
    }
  }

  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  const body = rawBody as SupportRequestInput;
  try {
    const { data, session: refreshedSession, refreshed } = await runWithRefreshedFirebaseToken(
      session,
      async (idToken) => {
        const loaded = await loadOwnRequest(session.uid, supportRequestId, idToken, {
          requireOpen: true,
        });
        if (loaded.kind !== "ok") {
          return loaded;
        }
        const validation = validateSupportRequest({
          type: loaded.type,
          subject: body.subject,
          description: body.description,
          severity: loaded.type === "bug" ? body.severity : undefined,
          category: body.category,
        });
        if (!validation.ok) {
          return { kind: "validation" as const, error: validation.error };
        }
        const now = new Date().toISOString();
        const fields: Record<string, FirestoreValue> = {
          subject: stringField(validation.value.subject),
          description: stringField(validation.value.description),
          category: stringField(validation.value.category),
          updatedAt: timestampField(now),
        };
        const mask = ["subject", "description", "category", "updatedAt"];
        if (loaded.type === "bug" && validation.value.severity) {
          fields.severity = stringField(validation.value.severity);
          mask.push("severity");
        }
        await patchDocument(loaded.path, fields, idToken, mask);
        return { kind: "ok" as const };
      },
    );

    if (data.kind === "family_not_found") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    if (data.kind === "not_found") {
      return NextResponse.json({ error: "support_request_not_found" }, { status: 404 });
    }
    if (data.kind === "not_editable") {
      return NextResponse.json({ error: "not_editable" }, { status: 409 });
    }
    if (data.kind === "validation") {
      return NextResponse.json({ error: data.error }, { status: 400 });
    }

    const response = NextResponse.json({ ok: true });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[SUPPORT_REQUEST_EDIT_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "update_support_request_failed");
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }
  const { supportRequestId } = await context.params;
  if (!supportRequestId) {
    return NextResponse.json({ error: "request_id_required" }, { status: 400 });
  }

  try {
    const { data, session: refreshedSession, refreshed } = await runWithRefreshedFirebaseToken(
      session,
      async (idToken) => {
        const loaded = await loadOwnRequest(session.uid, supportRequestId, idToken, {
          requireOpen: false,
        });
        if (loaded.kind !== "ok") {
          return loaded;
        }
        const now = new Date().toISOString();
        // End users cancel (hide from their list) — they never hard-delete.
        // The document stays intact for support/record-keeping; only a support
        // operator can actually delete it.
        await patchDocument(
          loaded.path,
          {
            cancelledByUser: boolField(true),
            cancelledAt: timestampField(now),
            updatedAt: timestampField(now),
          },
          idToken,
          ["cancelledByUser", "cancelledAt", "updatedAt"],
        );
        return { kind: "ok" as const };
      },
    );

    if (data.kind === "family_not_found") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    if (data.kind === "not_found") {
      return NextResponse.json({ error: "support_request_not_found" }, { status: 404 });
    }
    if (data.kind === "not_editable") {
      return NextResponse.json({ error: "not_editable" }, { status: 409 });
    }

    const response = NextResponse.json({ ok: true });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[SUPPORT_REQUEST_CANCEL_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "cancel_support_request_failed");
  }
}
