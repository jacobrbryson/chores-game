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
import {
  CHORE_SUGGESTIONS_COLLECTION,
  normalizeSuggestionDifficulty,
} from "@/lib/responsibility/catalog";
import { normalizeResponsibilityPillar } from "@/lib/responsibility/types";

export const runtime = "nodejs";

type UpdateSuggestionBody = {
  title?: unknown;
  pillar?: unknown;
  minAge?: unknown;
  maxAge?: unknown;
  difficulty?: unknown;
  estimatedMinutes?: unknown;
  popularity?: unknown;
  active?: unknown;
};

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ suggestionId: string }> },
) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isSupportAdmin(session)) {
    return NextResponse.json({ error: "support_admin_required" }, { status: 403 });
  }
  const { suggestionId } = await context.params;
  if (!suggestionId) {
    return NextResponse.json({ error: "suggestion_id_required" }, { status: 400 });
  }

  let body: UpdateSuggestionBody;
  try {
    body = (await request.json()) as UpdateSuggestionBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const fields: Record<string, FirestoreValue> = {
    updatedAt: timestampField(new Date().toISOString()),
  };
  const mask: string[] = ["updatedAt"];
  if (typeof body.title === "string" && body.title.trim()) {
    fields.title = stringField(body.title.trim().slice(0, 160));
    mask.push("title");
  }
  if (body.pillar !== undefined) {
    fields.pillar = stringField(normalizeResponsibilityPillar(body.pillar));
    mask.push("pillar");
  }
  if (typeof body.minAge === "number" && Number.isFinite(body.minAge)) {
    fields.minAge = integerField(Math.min(18, Math.max(0, Math.trunc(body.minAge))));
    mask.push("minAge");
  }
  if (typeof body.maxAge === "number" && Number.isFinite(body.maxAge)) {
    fields.maxAge = integerField(Math.min(18, Math.max(0, Math.trunc(body.maxAge))));
    mask.push("maxAge");
  }
  if (body.difficulty !== undefined) {
    fields.difficulty = stringField(normalizeSuggestionDifficulty(body.difficulty));
    mask.push("difficulty");
  }
  if (typeof body.estimatedMinutes === "number" && Number.isFinite(body.estimatedMinutes)) {
    fields.estimatedMinutes = integerField(Math.max(0, Math.trunc(body.estimatedMinutes)));
    mask.push("estimatedMinutes");
  }
  if (typeof body.popularity === "number" && Number.isFinite(body.popularity)) {
    fields.popularity = integerField(Math.max(0, Math.trunc(body.popularity)));
    mask.push("popularity");
  }
  if (typeof body.active === "boolean") {
    fields.active = boolField(body.active);
    mask.push("active");
  }

  try {
    await adminPatchDocument(`${CHORE_SUGGESTIONS_COLLECTION}/${suggestionId}`, fields, mask);
    return NextResponse.json({ success: true });
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 180) : "unknown";
    console.error("[SUPPORT_SUGGESTION_PATCH_ERROR]", reason);
    return NextResponse.json({ error: "update_suggestion_failed" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ suggestionId: string }> },
) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isSupportAdmin(session)) {
    return NextResponse.json({ error: "support_admin_required" }, { status: 403 });
  }
  const { suggestionId } = await context.params;
  if (!suggestionId) {
    return NextResponse.json({ error: "suggestion_id_required" }, { status: 400 });
  }
  try {
    await adminDeleteDocument(`${CHORE_SUGGESTIONS_COLLECTION}/${suggestionId}`);
    return NextResponse.json({ success: true });
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 180) : "unknown";
    console.error("[SUPPORT_SUGGESTION_DELETE_ERROR]", reason);
    return NextResponse.json({ error: "delete_suggestion_failed" }, { status: 500 });
  }
}
