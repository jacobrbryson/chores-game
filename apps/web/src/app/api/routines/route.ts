import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  boolField,
  createOrReplaceDocument,
  documentIdFromName,
  integerField,
  listAllDocuments,
  listDocuments,
  readBoolean,
  readString,
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
import { recordOperationMetric } from "@/lib/observability/metrics";
import { normalizeResponsibilityPillar } from "@/lib/responsibility/types";
import {
  MAX_ROUTINE_DESCRIPTION_LENGTH,
  MAX_ROUTINE_NAME_LENGTH,
  MAX_ROUTINES_PER_FAMILY,
  normalizeRoutineSteps,
  routineFromDoc,
} from "@/lib/responsibility/routines";

type CreateRoutineBody = {
  name?: unknown;
  description?: unknown;
  pillar?: unknown;
  steps?: unknown;
  completionBonusXp?: unknown;
  completionBonusCoins?: unknown;
};

function parseOptionalNonNegativeInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.trunc(value));
}

// Lists the family's routine templates. Admins additionally get the member
// directory so the Assign Routine flow can offer assignee choices without a
// second round-trip.
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  const operationStartedAt = Date.now();
  const ROUTINES_READ_CAP = 500;
  try {
    const { data, session: refreshedSession, refreshed } =
      await runWithRefreshedFirebaseToken(session, async (idToken) => {
        const familyId = await getPrimaryFamilyId(session.uid, idToken);
        if (!familyId) {
          return { kind: "family_not_found" as const };
        }
        const viewerRole = await getViewerRole(familyId, session.uid, idToken);
        const [routineDocs, memberDocs] = await Promise.all([
          listAllDocuments(`families/${familyId}/routines`, idToken, { cap: ROUTINES_READ_CAP }),
          viewerRole === "admin"
            ? listDocuments(`families/${familyId}/members`, idToken, 200)
            : Promise.resolve([]),
        ]);
        const routines = routineDocs
          .filter((doc) => !readBoolean(doc.fields, "deleted"))
          .map((doc) => routineFromDoc(doc))
          .filter((routine) => routine.steps.length > 0)
          .filter((routine) => viewerRole === "admin" || routine.active)
          .sort((a, b) => a.name.localeCompare(b.name));
        const members = memberDocs
          .filter((doc) => !readBoolean(doc.fields, "deleted"))
          .map((doc) => ({
            id: documentIdFromName(doc.name),
            name: readString(doc.fields, "name") || "Family member",
            role: readString(doc.fields, "role") === "admin" ? "admin" : "player",
          }));
        return { kind: "ok" as const, routines, members, viewerRole, routineDocCount: routineDocs.length, familyId };
      });

    if (data.kind === "family_not_found") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    const response = NextResponse.json({
      routines: data.routines,
      members: data.members,
      viewerRole: data.viewerRole,
    });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    void recordOperationMetric({
      area: "routines",
      operation: "list",
      durationMs: Date.now() - operationStartedAt,
      status: "ok",
      resultCount: data.routineDocCount,
      requestedLimit: ROUTINES_READ_CAP,
      hasNextPage: data.routineDocCount >= ROUTINES_READ_CAP,
      cursorConsumed: false,
      familyId: data.familyId,
      userId: session.uid,
    });
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[ROUTINES_GET_ERROR]", reason);
    void recordOperationMetric({
      area: "routines",
      operation: "list",
      durationMs: Date.now() - operationStartedAt,
      status: "error",
      errorCode: reason,
      requestedLimit: ROUTINES_READ_CAP,
      userId: session.uid,
    });
    return mapCommonFirestoreErrors(reason, "routines_unavailable");
  }
}

// Creates a routine. Admin only — routines are parent-curated structure, and
// this also keeps Kiosk Mode players from creating or editing them.
export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  let body: CreateRoutineBody;
  try {
    body = (await request.json()) as CreateRoutineBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const name =
    typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > MAX_ROUTINE_NAME_LENGTH) {
    return NextResponse.json({ error: "routine_name_invalid" }, { status: 400 });
  }
  const description =
    typeof body.description === "string"
      ? body.description.trim().slice(0, MAX_ROUTINE_DESCRIPTION_LENGTH)
      : "";
  const steps = normalizeRoutineSteps(body.steps);
  if (!steps) {
    return NextResponse.json({ error: "routine_steps_invalid" }, { status: 400 });
  }
  const pillar = normalizeResponsibilityPillar(body.pillar);
  const completionBonusXp =
    body.completionBonusXp === undefined
      ? -1
      : parseOptionalNonNegativeInt(body.completionBonusXp, -1);
  const completionBonusCoins = parseOptionalNonNegativeInt(body.completionBonusCoins, 0);

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
        const existing = await listAllDocuments(`families/${familyId}/routines`, idToken, {
          cap: MAX_ROUTINES_PER_FAMILY + 1,
        });
        const activeCount = existing.filter((doc) => !readBoolean(doc.fields, "deleted")).length;
        if (activeCount >= MAX_ROUTINES_PER_FAMILY) {
          return { kind: "routine_limit_reached" as const };
        }
        const now = new Date().toISOString();
        const routineId = randomUUID();
        await createOrReplaceDocument(
          `families/${familyId}/routines/${routineId}`,
          {
            name: stringField(name),
            description: stringField(description),
            pillar: stringField(pillar),
            stepsJson: stringField(JSON.stringify(steps)),
            completionBonusXp: integerField(completionBonusXp),
            completionBonusCoins: integerField(completionBonusCoins),
            timesUsed: integerField(0),
            timesCompleted: integerField(0),
            active: boolField(true),
            deleted: boolField(false),
            createdBy: stringField(session.uid),
            createdAt: timestampField(now),
            updatedAt: timestampField(now),
          },
          idToken,
        );
        await writeAuditLogBestEffort({
          familyId,
          idToken,
          eventType: "routine_created",
          actor: {
            uid: session.uid,
            email: session.email,
            name: session.name || session.email,
            role: viewerRole,
          },
          next: { routineId, name, pillar, stepCount: steps.length },
          reason: "create_routine",
        });
        await emitFamilyActivity({
          familyId,
          idToken,
          kind: "routine_created",
          actorUid: session.uid,
          actorEmail: session.email,
          actorName: session.name || session.email,
          title: "Routine added",
          message: `${session.name || "A parent"} added the "${name}" routine (${steps.length} steps).`,
        });
        return { kind: "ok" as const, routineId };
      });

    if (data.kind === "family_not_found") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    if (data.kind === "forbidden_action") {
      return NextResponse.json({ error: "forbidden_action" }, { status: 403 });
    }
    if (data.kind === "routine_limit_reached") {
      return NextResponse.json(
        { error: "routine_limit_reached", maxRoutines: MAX_ROUTINES_PER_FAMILY },
        { status: 409 },
      );
    }
    const response = NextResponse.json({ success: true, routineId: data.routineId });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[ROUTINES_POST_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "create_routine_failed");
  }
}
