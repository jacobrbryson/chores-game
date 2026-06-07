import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import { writeAuditLogBestEffort } from "@/lib/audit/log";
import {
  getPrimaryFamilyId,
  getViewerRole,
  jsonReauthRequired,
  jsonUnauthorized,
  mapCommonFirestoreErrors,
} from "@/lib/family/access";
import {
  getDocument,
  nullField,
  patchDocument,
  readTimestamp,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";
import { deletionScheduledForFrom } from "@/lib/privacy/config";
import { PRIVACY_AUDIT_EVENTS } from "@/lib/privacy/types";

// SERVER-SIDE TODO: this endpoint only *schedules* deletion (records intent +
// grace-period window). There is no safe, well-tested hard-deletion mechanism
// for an entire family yet, so no irreversible purge is performed here. When a
// purge job is built it must honor deletionScheduledFor, remain cancelable up to
// that moment, and cascade across the family's subcollections and per-member
// user records. The UI accurately states that deletion is *scheduled*.

export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  try {
    const { data, session: refreshedSession, refreshed } =
      await runWithRefreshedFirebaseToken(session, async (idToken) => {
        const familyId = await getPrimaryFamilyId(session.uid, idToken);
        if (!familyId) {
          return { kind: "no_family" as const };
        }
        const viewerRole = await getViewerRole(familyId, session.uid, idToken);
        if (viewerRole !== "admin") {
          return { kind: "forbidden" as const };
        }

        const familyDoc = await getDocument(`families/${familyId}`, idToken);
        const existingRequestedAt = readTimestamp(familyDoc.fields, "deletionRequestedAt");
        if (existingRequestedAt) {
          // Idempotent: already scheduled, return current window.
          return {
            kind: "ok" as const,
            deletionRequestedAt: existingRequestedAt,
            deletionScheduledFor: readTimestamp(familyDoc.fields, "deletionScheduledFor"),
            alreadyRequested: true,
          };
        }

        const now = new Date().toISOString();
        const scheduledFor = deletionScheduledForFrom(now);
        await patchDocument(
          `families/${familyId}`,
          {
            deletionRequestedAt: timestampField(now),
            deletionScheduledFor: timestampField(scheduledFor),
            deletionRequestedBy: stringField(session.uid),
            updatedAt: timestampField(now),
          },
          idToken,
          [
            "deletionRequestedAt",
            "deletionScheduledFor",
            "deletionRequestedBy",
            "updatedAt",
          ],
        );

        await writeAuditLogBestEffort({
          familyId,
          idToken,
          eventType: PRIVACY_AUDIT_EVENTS.deletionRequested,
          source: "privacy",
          actor: {
            uid: session.uid,
            email: session.email,
            name: session.name,
            role: viewerRole,
          },
          next: { deletionScheduledFor: scheduledFor },
        });

        return {
          kind: "ok" as const,
          deletionRequestedAt: now,
          deletionScheduledFor: scheduledFor,
          alreadyRequested: false,
        };
      });

    if (data.kind === "no_family") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    if (data.kind === "forbidden") {
      return NextResponse.json({ error: "forbidden_action" }, { status: 403 });
    }

    const response = NextResponse.json({
      deletionRequestedAt: data.deletionRequestedAt,
      deletionScheduledFor: data.deletionScheduledFor,
      alreadyRequested: data.alreadyRequested,
    });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[FAMILY_PRIVACY_DELETION_REQUEST_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "request_deletion_failed");
  }
}

export async function DELETE(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  try {
    const { data, session: refreshedSession, refreshed } =
      await runWithRefreshedFirebaseToken(session, async (idToken) => {
        const familyId = await getPrimaryFamilyId(session.uid, idToken);
        if (!familyId) {
          return { kind: "no_family" as const };
        }
        const viewerRole = await getViewerRole(familyId, session.uid, idToken);
        if (viewerRole !== "admin") {
          return { kind: "forbidden" as const };
        }

        const now = new Date().toISOString();
        await patchDocument(
          `families/${familyId}`,
          {
            deletionRequestedAt: nullField(),
            deletionScheduledFor: nullField(),
            deletionRequestedBy: nullField(),
            updatedAt: timestampField(now),
          },
          idToken,
          [
            "deletionRequestedAt",
            "deletionScheduledFor",
            "deletionRequestedBy",
            "updatedAt",
          ],
        );

        await writeAuditLogBestEffort({
          familyId,
          idToken,
          eventType: PRIVACY_AUDIT_EVENTS.deletionCanceled,
          source: "privacy",
          actor: {
            uid: session.uid,
            email: session.email,
            name: session.name,
            role: viewerRole,
          },
        });

        return { kind: "ok" as const };
      });

    if (data.kind === "no_family") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    if (data.kind === "forbidden") {
      return NextResponse.json({ error: "forbidden_action" }, { status: 403 });
    }

    const response = NextResponse.json({ canceled: true });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[FAMILY_PRIVACY_DELETION_CANCEL_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "cancel_deletion_failed");
  }
}
