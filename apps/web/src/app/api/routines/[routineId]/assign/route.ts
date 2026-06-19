import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  getDocument,
  integerField,
  listAllDocuments,
  patchDocument,
  readBoolean,
  readInteger,
  readString,
  readTimestamp,
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
import {
  DEFAULT_CHORE_COIN_VALUE,
  normalizeCoinValue,
  normalizeRecurrenceConfig,
} from "@/lib/chores/recurrence";
import { normalizeRoutineSteps, routineFromDoc } from "@/lib/responsibility/routines";
import { materializeRoutineAssignment } from "@/lib/responsibility/assignment-service";

type AssignRoutineBody = {
  assigneeId?: unknown;
  dueDate?: unknown;
  recurrenceType?: unknown;
  recurrenceInterval?: unknown;
  recurrenceUnit?: unknown;
  recurrenceDays?: unknown;
  completionBonusCoins?: unknown;
  // The (possibly customized) step list for this assignment. Optional — when
  // omitted, the saved template steps are used as-is.
  steps?: unknown;
  // When true, the customized steps are persisted back onto the template.
  updateRoutine?: unknown;
};

const MAX_ACTIVE_CHORES_PER_ASSIGNEE = 100;
const MAX_CHORE_ARCHIVE = 4000;

function normalizeChoreTitleKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}


// Assigns a routine to one player: snapshots the steps into a
// RoutineAssignment and materializes one ordinary chore per step. Admin only.
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ routineId: string }> },
) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }
  const { routineId } = await context.params;
  if (!routineId) {
    return NextResponse.json({ error: "routine_id_required" }, { status: 400 });
  }

  let body: AssignRoutineBody;
  try {
    body = (await request.json()) as AssignRoutineBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const assigneeId = typeof body.assigneeId === "string" ? body.assigneeId.trim() : "";
  if (!assigneeId) {
    return NextResponse.json({ error: "assignee_required" }, { status: 400 });
  }
  // Due date is intentionally not part of the assignment dialog — routine
  // step chores are due today, like freshly added chores.
  const dueDate =
    typeof body.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.dueDate)
      ? body.dueDate
      : new Date().toISOString().slice(0, 10);
  const recurrence = normalizeRecurrenceConfig({
    recurrenceType: body.recurrenceType,
    recurrenceInterval: body.recurrenceInterval,
    recurrenceUnit: body.recurrenceUnit,
    recurrenceDays: body.recurrenceDays,
  });
  const updateRoutine = body.updateRoutine === true;
  const customCompletionBonusCoins =
    typeof body.completionBonusCoins === "number" && Number.isFinite(body.completionBonusCoins)
      ? Math.max(0, Math.min(1000, Math.trunc(body.completionBonusCoins)))
      : undefined;
  const customSteps = body.steps !== undefined ? normalizeRoutineSteps(body.steps) : undefined;
  if (body.steps !== undefined && !customSteps) {
    return NextResponse.json({ error: "routine_steps_invalid" }, { status: 400 });
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
        const routineDoc = await getDocument(
          `families/${familyId}/routines/${routineId}`,
          idToken,
        );
        if (readBoolean(routineDoc.fields, "deleted")) {
          return { kind: "routine_not_found" as const };
        }
        const routine = routineFromDoc(routineDoc);
        const stepTitles = customSteps ?? routine.steps;
        if (stepTitles.length === 0) {
          return { kind: "routine_steps_invalid" as const };
        }

        // Resolve the assignee's display name and respect the active-chore cap.
        let assigneeName = "";
        try {
          const memberDoc = await getDocument(
            `families/${familyId}/members/${assigneeId}`,
            idToken,
          );
          if (readBoolean(memberDoc.fields, "deleted")) {
            return { kind: "assignee_not_found" as const };
          }
          assigneeName = readString(memberDoc.fields, "name");
        } catch (error) {
          const reason = error instanceof Error ? error.message : "";
          if (reason.includes("FIRESTORE_HTTP_404")) {
            return { kind: "assignee_not_found" as const };
          }
          throw error;
        }
        const choreDocs = await listAllDocuments(`families/${familyId}/chores`, idToken, {
          cap: MAX_CHORE_ARCHIVE,
        });
        const activeCount = choreDocs.filter(
          (doc) =>
            !readBoolean(doc.fields, "deleted") &&
            readString(doc.fields, "status") === "Open" &&
            readString(doc.fields, "assigneeId") === assigneeId,
        ).length;
        if (activeCount + stepTitles.length > MAX_ACTIVE_CHORES_PER_ASSIGNEE) {
          return { kind: "active_chore_limit_reached" as const };
        }

        // Step chores are real chores: steps may carry explicit coins +
        // approval (set in the dialog or saved on the template); otherwise
        // the family's most recent chore with the same title supplies them,
        // and brand-new chores fall back to the default coin value with no
        // approval requirement.
        const choreSettingsByTitle = new Map<
          string,
          { coinValue: number; requireApproval: boolean; createdAt: string }
        >();
        for (const doc of choreDocs) {
          if (readBoolean(doc.fields, "deleted")) {
            continue;
          }
          const titleKey = normalizeChoreTitleKey(readString(doc.fields, "title"));
          if (!titleKey) {
            continue;
          }
          const createdAt = readTimestamp(doc.fields, "createdAt") || "";
          const existing = choreSettingsByTitle.get(titleKey);
          if (!existing || createdAt > existing.createdAt) {
            choreSettingsByTitle.set(titleKey, {
              coinValue: normalizeCoinValue(readInteger(doc.fields, "coinValue")),
              requireApproval: readBoolean(doc.fields, "requireApproval"),
              createdAt,
            });
          }
        }
        const steps = stepTitles.map((step) => {
          const matched = choreSettingsByTitle.get(normalizeChoreTitleKey(step.title));
          return {
            id: step.id,
            title: step.title,
            coinValue: step.coinValue ?? matched?.coinValue ?? DEFAULT_CHORE_COIN_VALUE,
            requireApproval: step.requireApproval ?? matched?.requireApproval ?? false,
          };
        });

        const { assignmentId, choreIds } = await materializeRoutineAssignment({
          familyId,
          idToken,
          routine: {
            id: routine.id,
            name: routine.name,
            pillar: routine.pillar,
            completionBonusXp: routine.completionBonusXp,
            completionBonusCoins:
              customCompletionBonusCoins ?? routine.completionBonusCoins,
          },
          steps,
          assigneeId,
          assigneeName: assigneeName || "Family member",
          dueDate,
          recurrence,
          assignedBy: {
            uid: session.uid,
            email: session.email,
            name: session.name || session.email,
          },
        });

        // "Update the saved Routine with these changes" — persist the
        // customized steps back onto the template only when asked.
        if (updateRoutine && (customSteps || customCompletionBonusCoins !== undefined)) {
          await patchDocument(
            `families/${familyId}/routines/${routineId}`,
            {
              ...(customSteps ? { stepsJson: stringField(JSON.stringify(customSteps)) } : {}),
              ...(customCompletionBonusCoins !== undefined
                ? { completionBonusCoins: integerField(customCompletionBonusCoins) }
                : {}),
              updatedAt: timestampField(new Date().toISOString()),
            },
            idToken,
            [
              ...(customSteps ? ["stepsJson"] : []),
              ...(customCompletionBonusCoins !== undefined ? ["completionBonusCoins"] : []),
              "updatedAt",
            ],
          );
        }

        await writeAuditLogBestEffort({
          familyId,
          idToken,
          eventType: "routine_assigned",
          actor: {
            uid: session.uid,
            email: session.email,
            name: session.name || session.email,
            role: viewerRole,
          },
          next: {
            routineId,
            assignmentId,
            assigneeId,
            stepCount: steps.length,
            dueDate,
            recurrenceType: recurrence.recurrenceType,
            updatedTemplate:
              updateRoutine &&
              (Boolean(customSteps) || customCompletionBonusCoins !== undefined),
          },
          reason: "assign_routine",
        });

        return { kind: "ok" as const, assignmentId, choreIds };
      });

    if (data.kind === "family_not_found") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    if (data.kind === "forbidden_action") {
      return NextResponse.json({ error: "forbidden_action" }, { status: 403 });
    }
    if (data.kind === "routine_not_found") {
      return NextResponse.json({ error: "routine_not_found" }, { status: 404 });
    }
    if (data.kind === "routine_steps_invalid") {
      return NextResponse.json({ error: "routine_steps_invalid" }, { status: 400 });
    }
    if (data.kind === "assignee_not_found") {
      return NextResponse.json({ error: "assignee_not_found" }, { status: 400 });
    }
    if (data.kind === "active_chore_limit_reached") {
      return NextResponse.json(
        { error: "active_chore_limit_reached", maxActiveChores: MAX_ACTIVE_CHORES_PER_ASSIGNEE },
        { status: 409 },
      );
    }
    const response = NextResponse.json({
      success: true,
      assignmentId: data.assignmentId,
      choreIds: data.choreIds,
    });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[ROUTINE_ASSIGN_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "assign_routine_failed");
  }
}
