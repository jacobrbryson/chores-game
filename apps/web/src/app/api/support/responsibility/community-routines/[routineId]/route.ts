import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { isSupportAdmin } from "@/lib/support/access";
import { adminDeleteDocument, adminPatchDocument } from "@/lib/firestore/admin";
import {
  boolField,
  integerField,
  stringField,
  timestampField,
  type FirestoreValue,
} from "@/lib/firestore/rest";
import { COMMUNITY_ROUTINES_COLLECTION } from "@/lib/responsibility/catalog";
import { normalizeRoutineSteps } from "@/lib/responsibility/routines";
import { normalizeResponsibilityPillar } from "@/lib/responsibility/types";

export const runtime = "nodejs";

type UpdateCommunityRoutineBody = {
  name?: unknown;
  pillar?: unknown;
  steps?: unknown;
  minAge?: unknown;
  maxAge?: unknown;
  // Moderation actions: approve/reject/feature/unfeature, or direct edits.
  status?: unknown;
  featured?: unknown;
};

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ routineId: string }> },
) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isSupportAdmin(session)) {
    return NextResponse.json({ error: "support_admin_required" }, { status: 403 });
  }
  const { routineId } = await context.params;
  if (!routineId) {
    return NextResponse.json({ error: "routine_id_required" }, { status: 400 });
  }

  let body: UpdateCommunityRoutineBody;
  try {
    body = (await request.json()) as UpdateCommunityRoutineBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const fields: Record<string, FirestoreValue> = {
    updatedAt: timestampField(new Date().toISOString()),
  };
  const mask: string[] = ["updatedAt"];
  if (typeof body.name === "string" && body.name.trim()) {
    fields.name = stringField(body.name.trim().slice(0, 120));
    mask.push("name");
  }
  if (body.pillar !== undefined) {
    fields.pillar = stringField(normalizeResponsibilityPillar(body.pillar));
    mask.push("pillar");
  }
  if (body.steps !== undefined) {
    const steps = normalizeRoutineSteps(body.steps);
    if (!steps) {
      return NextResponse.json({ error: "routine_steps_invalid" }, { status: 400 });
    }
    fields.stepsJson = stringField(JSON.stringify(steps));
    mask.push("stepsJson");
  }
  if (typeof body.minAge === "number" && Number.isFinite(body.minAge)) {
    fields.minAge = integerField(Math.min(18, Math.max(0, Math.trunc(body.minAge))));
    mask.push("minAge");
  }
  if (typeof body.maxAge === "number" && Number.isFinite(body.maxAge)) {
    fields.maxAge = integerField(Math.min(18, Math.max(0, Math.trunc(body.maxAge))));
    mask.push("maxAge");
  }
  if (body.status === "pending" || body.status === "approved" || body.status === "rejected") {
    fields.status = stringField(body.status);
    mask.push("status");
  }
  if (typeof body.featured === "boolean") {
    fields.featured = boolField(body.featured);
    mask.push("featured");
  }

  try {
    await adminPatchDocument(`${COMMUNITY_ROUTINES_COLLECTION}/${routineId}`, fields, mask);
    return NextResponse.json({ success: true });
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 180) : "unknown";
    console.error("[SUPPORT_COMMUNITY_ROUTINE_PATCH_ERROR]", reason);
    return NextResponse.json({ error: "update_community_routine_failed" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ routineId: string }> },
) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isSupportAdmin(session)) {
    return NextResponse.json({ error: "support_admin_required" }, { status: 403 });
  }
  const { routineId } = await context.params;
  if (!routineId) {
    return NextResponse.json({ error: "routine_id_required" }, { status: 400 });
  }
  try {
    await adminDeleteDocument(`${COMMUNITY_ROUTINES_COLLECTION}/${routineId}`);
    return NextResponse.json({ success: true });
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 180) : "unknown";
    console.error("[SUPPORT_COMMUNITY_ROUTINE_DELETE_ERROR]", reason);
    return NextResponse.json({ error: "delete_community_routine_failed" }, { status: 500 });
  }
}
