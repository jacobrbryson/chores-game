import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  boolField,
  getDocument,
  integerField,
  patchDocument,
  readBoolean,
  stringField,
  timestampField,
  type FirestoreValue,
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
import { normalizeResponsibilityPillar } from "@/lib/responsibility/types";
import {
  MAX_ROUTINE_DESCRIPTION_LENGTH,
  MAX_ROUTINE_NAME_LENGTH,
  normalizeRoutineSteps,
  routineFromDoc,
} from "@/lib/responsibility/routines";

type UpdateRoutineBody = {
  name?: unknown;
  description?: unknown;
  pillar?: unknown;
  steps?: unknown;
  completionBonusXp?: unknown;
  completionBonusCoins?: unknown;
  active?: unknown;
};

// Updates routine metadata/steps. Admin only.
export async function PATCH(
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

  let body: UpdateRoutineBody;
  try {
    body = (await request.json()) as UpdateRoutineBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
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
        const routinePath = `families/${familyId}/routines/${routineId}`;
        const existingDoc = await getDocument(routinePath, idToken);
        if (readBoolean(existingDoc.fields, "deleted")) {
          return { kind: "routine_not_found" as const };
        }
        const existing = routineFromDoc(existingDoc);
        const now = new Date().toISOString();
        const fields: Record<string, FirestoreValue> = {
          updatedAt: timestampField(now),
        };
        const mask: string[] = ["updatedAt"];
        // Routine assignments snapshot these fields. Updating the template
        // must not rewrite an occurrence that is already in progress.
        if (typeof body.name === "string") {
          const name = body.name.trim().replace(/\s+/g, " ");
          if (!name || name.length > MAX_ROUTINE_NAME_LENGTH) {
            return { kind: "routine_name_invalid" as const };
          }
          fields.name = stringField(name);
          mask.push("name");
        }
        if (typeof body.description === "string") {
          fields.description = stringField(
            body.description.trim().slice(0, MAX_ROUTINE_DESCRIPTION_LENGTH),
          );
          mask.push("description");
        }
        if (body.pillar !== undefined) {
          fields.pillar = stringField(normalizeResponsibilityPillar(body.pillar));
          mask.push("pillar");
        }
        if (body.steps !== undefined) {
          const steps = normalizeRoutineSteps(body.steps);
          if (!steps) {
            return { kind: "routine_steps_invalid" as const };
          }
          fields.stepsJson = stringField(JSON.stringify(steps));
          mask.push("stepsJson");
        }
        if (typeof body.completionBonusXp === "number" && Number.isFinite(body.completionBonusXp)) {
          fields.completionBonusXp = integerField(Math.max(-1, Math.trunc(body.completionBonusXp)));
          mask.push("completionBonusXp");
        }
        if (
          typeof body.completionBonusCoins === "number" &&
          Number.isFinite(body.completionBonusCoins)
        ) {
          fields.completionBonusCoins = integerField(
            Math.max(0, Math.trunc(body.completionBonusCoins)),
          );
          mask.push("completionBonusCoins");
        }
        if (typeof body.active === "boolean") {
          fields.active = boolField(body.active);
          mask.push("active");
        }
        await patchDocument(routinePath, fields, idToken, mask);
        await writeAuditLogBestEffort({
          familyId,
          idToken,
          eventType: "routine_updated",
          actor: {
            uid: session.uid,
            email: session.email,
            name: session.name || session.email,
            role: viewerRole,
          },
          previous: { name: existing.name, pillar: existing.pillar },
          next: { routineId, updatedFields: mask.join(",") },
          reason: "update_routine",
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
    if (data.kind === "routine_not_found") {
      return NextResponse.json({ error: "routine_not_found" }, { status: 404 });
    }
    if (data.kind === "routine_name_invalid") {
      return NextResponse.json({ error: "routine_name_invalid" }, { status: 400 });
    }
    if (data.kind === "routine_steps_invalid") {
      return NextResponse.json({ error: "routine_steps_invalid" }, { status: 400 });
    }
    const response = NextResponse.json({ success: true });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[ROUTINE_PATCH_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "update_routine_failed");
  }
}

// Soft-deletes a routine. Admin only. Historical XP events and runs remain.
export async function DELETE(
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
        const routinePath = `families/${familyId}/routines/${routineId}`;
        const existingDoc = await getDocument(routinePath, idToken);
        if (readBoolean(existingDoc.fields, "deleted")) {
          return { kind: "routine_not_found" as const };
        }
        const existing = routineFromDoc(existingDoc);
        const now = new Date().toISOString();
        await patchDocument(
          routinePath,
          {
            deleted: boolField(true),
            deletedAt: timestampField(now),
            active: boolField(false),
            updatedAt: timestampField(now),
          },
          idToken,
          ["deleted", "deletedAt", "active", "updatedAt"],
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
          previous: { routineId, name: existing.name },
          reason: "delete_routine",
        });
        await emitFamilyActivity({
          familyId,
          idToken,
          kind: "routine_updated",
          actorUid: session.uid,
          actorEmail: session.email,
          actorName: session.name || session.email,
          title: "Routine removed",
          message: `${session.name || "A parent"} removed the "${existing.name}" routine.`,
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
    if (data.kind === "routine_not_found") {
      return NextResponse.json({ error: "routine_not_found" }, { status: 404 });
    }
    const response = NextResponse.json({ success: true });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[ROUTINE_DELETE_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "delete_routine_failed");
  }
}
