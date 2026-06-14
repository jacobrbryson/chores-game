import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  boolField,
  getDocument,
  patchDocument,
  readBoolean,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";
import {
  getPrimaryFamilyId,
  getViewerRole,
  jsonReauthRequired,
  jsonUnauthorized,
  mapCommonFirestoreErrors,
} from "@/lib/family/access";
import { writeAuditLogBestEffort } from "@/lib/audit/log";
import { emitFamilyActivity } from "@/lib/notifications/events";
import { publishFamilyActivity } from "@/lib/ws/publish-family-activity";
import { loadResponsibilityConfig } from "@/lib/responsibility/config";
import { routineAssignmentFromDoc } from "@/lib/responsibility/assignments";

// Read-only view of one routine assignment, used by the routine progress
// dialog. Any family member can read it (players see their own routines in
// the dashboard and in Kiosk Mode); all mutations flow through the normal
// chore endpoints.
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ assignmentId: string }> },
) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }
  const { assignmentId } = await context.params;
  if (!assignmentId) {
    return NextResponse.json({ error: "assignment_id_required" }, { status: 400 });
  }

  try {
    const { data, session: refreshedSession, refreshed } =
      await runWithRefreshedFirebaseToken(session, async (idToken) => {
        const familyId = await getPrimaryFamilyId(session.uid, idToken);
        if (!familyId) {
          return { kind: "family_not_found" as const };
        }
        const viewerRole = await getViewerRole(familyId, session.uid, idToken);
        let assignmentDoc;
        try {
          assignmentDoc = await getDocument(
            `families/${familyId}/routineAssignments/${assignmentId}`,
            idToken,
          );
        } catch (error) {
          const reason = error instanceof Error ? error.message : "";
          if (reason.includes("FIRESTORE_HTTP_404")) {
            return { kind: "assignment_not_found" as const };
          }
          throw error;
        }
        const assignment = routineAssignmentFromDoc(assignmentDoc);
        const config = await loadResponsibilityConfig();
        const completionBonusXp =
          assignment.completionBonusXp >= 0
            ? assignment.completionBonusXp
            : config.xpValues.routineCompletionBonusXp;
        return {
          kind: "ok" as const,
          assignment,
          completionBonusXp,
          stepXp: config.xpValues.routineStepXp,
          viewerRole,
        };
      });

    if (data.kind === "family_not_found") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    if (data.kind === "assignment_not_found") {
      return NextResponse.json({ error: "assignment_not_found" }, { status: 404 });
    }
    const response = NextResponse.json({
      assignment: data.assignment,
      completionBonusXp: data.completionBonusXp,
      stepXp: data.stepXp,
      viewerRole: data.viewerRole,
    });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[ROUTINE_ASSIGNMENT_GET_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "assignment_unavailable");
  }
}

// Deletes a whole assigned routine occurrence: the assignment record plus every
// one of its materialized step chores. Admin only. Already-completed (paid)
// steps keep their coins — a bulk routine removal never claws back rewards the
// child already earned. To change a routine's steps instead of removing it,
// parents edit the template on the Routines page. Soft-delete keeps history and
// stops template-edit reconciliation from re-materializing the steps.
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ assignmentId: string }> },
) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }
  const { assignmentId } = await context.params;
  if (!assignmentId) {
    return NextResponse.json({ error: "assignment_id_required" }, { status: 400 });
  }

  try {
    const { data, session: refreshedSession, refreshed } =
      await runWithRefreshedFirebaseToken(session, async (idToken) => {
        const familyId = await getPrimaryFamilyId(session.uid, idToken);
        if (!familyId) {
          return { kind: "family_not_found" as const };
        }
        const viewerRole = await getViewerRole(familyId, session.uid, idToken);
        if (viewerRole !== "admin") {
          return { kind: "forbidden_action" as const };
        }
        const assignmentPath = `families/${familyId}/routineAssignments/${assignmentId}`;
        let assignmentDoc;
        try {
          assignmentDoc = await getDocument(assignmentPath, idToken);
        } catch (error) {
          const reason = error instanceof Error ? error.message : "";
          if (reason.includes("FIRESTORE_HTTP_404")) {
            return { kind: "assignment_not_found" as const };
          }
          throw error;
        }
        if (readBoolean(assignmentDoc.fields, "deleted")) {
          return { kind: "assignment_not_found" as const };
        }
        const assignment = routineAssignmentFromDoc(assignmentDoc);
        const now = new Date().toISOString();

        // Soft-delete each still-present step chore. Approved steps keep their
        // coins (no clawback); they simply leave the active lists.
        await Promise.all(
          assignment.steps.map(async (step) => {
            const chorePath = `families/${familyId}/chores/${step.choreId}`;
            try {
              const choreDoc = await getDocument(chorePath, idToken);
              if (readBoolean(choreDoc.fields, "deleted")) {
                return;
              }
              await patchDocument(
                chorePath,
                {
                  deleted: boolField(true),
                  deletedAt: timestampField(now),
                  status: stringField("Deleted"),
                  updatedAt: timestampField(now),
                },
                idToken,
                ["deleted", "deletedAt", "status", "updatedAt"],
              );
            } catch (error) {
              const reason = error instanceof Error ? error.message : "";
              if (!reason.includes("FIRESTORE_HTTP_404")) {
                throw error;
              }
            }
          }),
        );

        await patchDocument(
          assignmentPath,
          {
            deleted: boolField(true),
            deletedAt: timestampField(now),
            updatedAt: timestampField(now),
          },
          idToken,
          ["deleted", "deletedAt", "updatedAt"],
        );

        await writeAuditLogBestEffort({
          familyId,
          idToken,
          eventType: "routine_deleted",
          actor: {
            uid: session.uid,
            email: session.email,
            name: session.name || session.email,
            role: viewerRole,
          },
          userId: assignment.assigneeId,
          next: {
            assignmentId,
            routineId: assignment.routineId,
            stepCount: assignment.steps.length,
          },
          reason: "delete_routine_assignment",
        });
        await emitFamilyActivity({
          familyId,
          idToken,
          kind: "routine_updated",
          actorUid: session.uid,
          actorEmail: session.email,
          actorName: session.name || session.email,
          title: "Routine removed",
          message: `${session.name || "A parent"} removed the "${assignment.routineName}" routine from ${assignment.assigneeName}.`,
          relatedIds: assignment.assigneeId ? [assignment.assigneeId] : [],
        });
        await publishFamilyActivity({
          type: "routine_updated",
          familyId,
          occurredAt: now,
        });
        return { kind: "ok" as const };
      });

    if (data.kind === "family_not_found") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    if (data.kind === "forbidden_action") {
      return NextResponse.json({ error: "forbidden_action" }, { status: 403 });
    }
    if (data.kind === "assignment_not_found") {
      return NextResponse.json({ error: "assignment_not_found" }, { status: 404 });
    }
    const response = NextResponse.json({ success: true });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[ROUTINE_ASSIGNMENT_DELETE_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "delete_routine_assignment_failed");
  }
}
