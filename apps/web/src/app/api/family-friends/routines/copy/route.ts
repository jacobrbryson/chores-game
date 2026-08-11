import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { writeAuditLogBestEffort } from "@/lib/audit/log";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import { getViewerFamilyContext } from "@/lib/family/member-access";
import { listFamilyFriends } from "@/lib/family-friends/repository";
import { adminGetDocument, adminListAllDocuments } from "@/lib/firestore/admin";
import {
  boolField,
  createOrReplaceDocument,
  integerField,
  listAllDocuments,
  readBoolean,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";
import { emitFamilyActivity } from "@/lib/notifications/events";
import {
  MAX_ROUTINES_PER_FAMILY,
  normalizeRoutineSteps,
  routineFromDoc,
} from "@/lib/responsibility/routines";
import { publishFamilyActivity } from "@/lib/ws/publish-family-activity";

type CopyBody = {
  sourceFamilyId?: unknown;
  routineId?: unknown;
  routineName?: unknown;
  steps?: unknown;
};

function normalizeRoutineName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

async function resolveSourceRoutine(
  sourceFamilyId: string,
  requestedRoutineId: string,
  requestedRoutineName: string,
) {
  if (requestedRoutineId) {
    try {
      const doc = await adminGetDocument(
        `families/${sourceFamilyId}/routines/${requestedRoutineId}`,
      );
      return readBoolean(doc.fields, "deleted") ? null : routineFromDoc(doc);
    } catch (error) {
      if (error instanceof Error && error.message.includes("FIRESTORE_ADMIN_HTTP_404")) {
        return null;
      }
      throw error;
    }
  }
  const requestedNameKey = normalizeRoutineName(requestedRoutineName);
  const candidates = (await adminListAllDocuments(
    `families/${sourceFamilyId}/routines`,
    { cap: MAX_ROUTINES_PER_FAMILY + 1 },
  ))
    .filter((doc) => !readBoolean(doc.fields, "deleted"))
    .map((doc) => routineFromDoc(doc))
    .filter((routine) => normalizeRoutineName(routine.name) === requestedNameKey)
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  return candidates[0] ?? null;
}

async function authorizeSource(
  session: NonNullable<ReturnType<typeof getSessionFromRequest>>,
  idToken: string,
  sourceFamilyId: string,
) {
  const context = await getViewerFamilyContext(session.uid, session.email, idToken);
  if (!context.familyId) return { kind: "family_not_found" as const };
  if (context.viewerRole !== "admin") return { kind: "forbidden" as const };
  const isFriend = (await listFamilyFriends(context.familyId)).some(
    (friend) => friend.familyId === sourceFamilyId,
  );
  return isFriend
    ? { kind: "ok" as const, context }
    : { kind: "not_family_friends" as const };
}

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const sourceFamilyId = params.get("sourceFamilyId")?.trim() ?? "";
  const requestedRoutineId = params.get("routineId")?.trim() ?? "";
  const requestedRoutineName = params.get("routineName")?.trim().slice(0, 120) ?? "";
  if (!sourceFamilyId || (!requestedRoutineId && !requestedRoutineName)) {
    return NextResponse.json({ error: "source_required" }, { status: 400 });
  }
  try {
    const result = await runWithRefreshedFirebaseToken(session, async (idToken) => {
      const access = await authorizeSource(session, idToken, sourceFamilyId);
      if (access.kind !== "ok") return access;
      const routine = await resolveSourceRoutine(
        sourceFamilyId,
        requestedRoutineId,
        requestedRoutineName,
      );
      return routine && routine.steps.length > 0
        ? { kind: "ok" as const, routine }
        : { kind: "routine_not_found" as const };
    });
    if (result.data.kind !== "ok") {
      const status =
        result.data.kind === "forbidden" || result.data.kind === "not_family_friends"
          ? 403
          : 404;
      return NextResponse.json({ error: result.data.kind }, { status });
    }
    const response = NextResponse.json({ routine: result.data.routine });
    if (result.refreshed) setSessionUserCookie(response, result.session);
    return response;
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 180) : "unknown";
    console.error("[FAMILY_FRIEND_ROUTINE_PREVIEW_ERROR]", reason);
    return NextResponse.json({ error: "family_friend_routine_preview_failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: CopyBody;
  try {
    body = (await request.json()) as CopyBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const sourceFamilyId =
    typeof body.sourceFamilyId === "string" ? body.sourceFamilyId.trim() : "";
  const requestedRoutineId = typeof body.routineId === "string" ? body.routineId.trim() : "";
  const requestedRoutineName =
    typeof body.routineName === "string" ? body.routineName.trim().slice(0, 120) : "";
  const customSteps = body.steps === undefined ? undefined : normalizeRoutineSteps(body.steps);
  if (!sourceFamilyId || (!requestedRoutineId && !requestedRoutineName)) {
    return NextResponse.json({ error: "source_required" }, { status: 400 });
  }
  if (body.steps !== undefined && !customSteps) {
    return NextResponse.json({ error: "routine_steps_invalid" }, { status: 400 });
  }

  try {
    const result = await runWithRefreshedFirebaseToken(session, async (idToken) => {
      const access = await authorizeSource(session, idToken, sourceFamilyId);
      if (access.kind !== "ok") return access;
      const { context } = access;
      const sourceRoutine = await resolveSourceRoutine(
        sourceFamilyId,
        requestedRoutineId,
        requestedRoutineName,
      );
      if (!sourceRoutine) return { kind: "routine_not_found" as const };
      const sourceRoutineId = sourceRoutine.id;
      if (!sourceRoutine.name || sourceRoutine.steps.length === 0) {
        return { kind: "routine_not_found" as const };
      }

      const existing = await listAllDocuments(
        `families/${context.familyId}/routines`,
        idToken,
        { cap: MAX_ROUTINES_PER_FAMILY + 1 },
      );
      if (existing.filter((doc) => !readBoolean(doc.fields, "deleted")).length >= MAX_ROUTINES_PER_FAMILY) {
        return { kind: "routine_limit_reached" as const };
      }

      const copiedSteps = customSteps ?? sourceRoutine.steps;
      const routineId = randomUUID();
      const now = new Date().toISOString();
      await createOrReplaceDocument(
        `families/${context.familyId}/routines/${routineId}`,
        {
          name: stringField(sourceRoutine.name),
          description: stringField(sourceRoutine.description),
          pillar: stringField(sourceRoutine.pillar),
          stepsJson: stringField(JSON.stringify(copiedSteps)),
          completionBonusXp: integerField(sourceRoutine.completionBonusXp),
          completionBonusCoins: integerField(sourceRoutine.completionBonusCoins),
          timesUsed: integerField(0),
          timesCompleted: integerField(0),
          active: boolField(true),
          deleted: boolField(false),
          copiedFromFriendFamilyId: stringField(sourceFamilyId),
          copiedFromFriendRoutineId: stringField(sourceRoutineId),
          createdBy: stringField(session.uid),
          createdAt: timestampField(now),
          updatedAt: timestampField(now),
        },
        idToken,
      );

      await emitFamilyActivity({
        familyId: context.familyId,
        idToken,
        kind: "routine_created",
        actorUid: session.uid,
        actorEmail: session.email,
        actorName: session.name,
        title: "Routine added",
        message: `${session.name || "A parent"} added the "${sourceRoutine.name}" routine (${copiedSteps.length} steps).`,
        routineId,
        routineName: sourceRoutine.name,
      });
      await publishFamilyActivity({
        type: "routine_created",
        familyId: context.familyId,
        occurredAt: now,
      });
      void writeAuditLogBestEffort({
        familyId: context.familyId,
        idToken,
        eventType: "family_friend_routine_copied",
        actor: { uid: session.uid, email: session.email, name: session.name, role: "admin" },
        source: "family_friends",
        requestId: routineId,
        next: {
          sourceFamilyId,
          sourceRoutineId,
          routineId,
          sourceStepCount: sourceRoutine.steps.length,
          stepCount: copiedSteps.length,
        },
      });
      return {
        kind: "ok" as const,
        routineId,
        routineName: sourceRoutine.name,
        stepCount: copiedSteps.length,
      };
    });

    if (result.data.kind !== "ok") {
      const status =
        result.data.kind === "forbidden" || result.data.kind === "not_family_friends"
          ? 403
          : result.data.kind === "routine_limit_reached"
            ? 409
            : 404;
      return NextResponse.json({ error: result.data.kind }, { status });
    }
    const response = NextResponse.json(
      {
        routineId: result.data.routineId,
        routineName: result.data.routineName,
        stepCount: result.data.stepCount,
      },
      { status: 201 },
    );
    if (result.refreshed) setSessionUserCookie(response, result.session);
    return response;
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 180) : "unknown";
    console.error("[FAMILY_FRIEND_ROUTINE_COPY_ERROR]", reason);
    return NextResponse.json({ error: "family_friend_routine_copy_failed" }, { status: 500 });
  }
}
