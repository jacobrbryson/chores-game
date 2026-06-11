import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { adminCommitWrites, adminGetDocument } from "@/lib/firestore/admin";
import { mapField, readBoolean, readString, stringField, timestampField } from "@/lib/firestore/rest";
import { isSupportAdmin } from "@/lib/support/access";
import { loadSupportRequestDetail } from "@/lib/support/management";

type RouteContext = { params: Promise<{ supportRequestId: string }> };
type AddNoteBody = { familyId?: unknown; body?: unknown };

export const runtime = "nodejs";

const MAX_NOTE_LENGTH = 4000;

// Adds an internal-only operator note (Phase 10). Notes live in a dedicated
// subcollection and are never exposed to end users — only the support console
// reads them via loadSupportRequestDetail.
export async function POST(request: NextRequest, context: RouteContext) {
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

  let body: AddNoteBody;
  try {
    body = (await request.json()) as AddNoteBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const familyId = typeof body.familyId === "string" ? body.familyId.trim() : "";
  const noteBody = typeof body.body === "string" ? body.body.trim().slice(0, MAX_NOTE_LENGTH) : "";
  if (!familyId) {
    return NextResponse.json({ error: "family_id_required" }, { status: 400 });
  }
  if (!noteBody) {
    return NextResponse.json({ error: "note_required" }, { status: 400 });
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

  const now = new Date().toISOString();
  const noteId = `${now.replace(/[^0-9]/g, "")}_${randomUUID()}`;
  const auditId = `${now.replace(/[^0-9]/g, "")}_${randomUUID()}`;

  try {
    await adminCommitWrites([
      {
        update: {
          path: `${path}/internalNotes/${noteId}`,
          fields: {
            id: stringField(noteId),
            body: stringField(noteBody),
            authorUid: stringField(session.uid),
            authorEmail: stringField(session.email ?? ""),
            authorName: stringField(session.name ?? ""),
            createdAt: timestampField(now),
          },
        },
      },
      {
        update: {
          path: `families/${familyId}/auditLogs/${auditId}`,
          fields: {
            familyId: stringField(familyId),
            eventType: stringField("support_request_note_added"),
            actorUid: stringField(session.uid),
            actorEmail: stringField(session.email ?? ""),
            actorName: stringField(session.name ?? ""),
            actorRole: stringField("support"),
            userId: stringField(readString(existingDoc.fields, "createdByUid")),
            source: stringField("support_admin"),
            reason: stringField("internal_note_added"),
            requestId: stringField(supportRequestId),
            previous: mapField({}),
            next: mapField({ noteId: stringField(noteId) }),
            createdAt: timestampField(now),
          },
        },
      },
    ]);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.error("[SUPPORT_REQUEST_NOTE_ADD_ERROR]", reason.slice(0, 240));
    return NextResponse.json({ error: "add_note_failed" }, { status: 500 });
  }

  const detail = await loadSupportRequestDetail(familyId, supportRequestId);
  return NextResponse.json({ notes: detail.notes });
}
