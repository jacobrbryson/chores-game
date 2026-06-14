import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { isSupportAdmin } from "@/lib/support/access";
import { adminCreateDocument, adminListAllDocuments } from "@/lib/firestore/admin";
import {
  boolField,
  integerField,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";
import {
  CHORE_SUGGESTIONS_COLLECTION,
  choreSuggestionFromDoc,
  normalizeSuggestionDifficulty,
} from "@/lib/responsibility/catalog";
import { normalizeResponsibilityPillar } from "@/lib/responsibility/types";

export const runtime = "nodejs";

function requireSupport(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  if (!isSupportAdmin(session)) {
    return {
      error: NextResponse.json({ error: "support_admin_required" }, { status: 403 }),
    };
  }
  return { session };
}

// Lists every curated chore suggestion (including inactive) for management.
export async function GET(request: NextRequest) {
  const gate = requireSupport(request);
  if (gate.error) {
    return gate.error;
  }
  try {
    const docs = await adminListAllDocuments(CHORE_SUGGESTIONS_COLLECTION, { cap: 500 });
    const suggestions = docs
      .map((doc) => choreSuggestionFromDoc(doc))
      .sort((a, b) => a.title.localeCompare(b.title));
    return NextResponse.json({ suggestions });
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 180) : "unknown";
    console.error("[SUPPORT_SUGGESTIONS_GET_ERROR]", reason);
    return NextResponse.json({ error: "suggestions_unavailable" }, { status: 500 });
  }
}

type CreateSuggestionBody = {
  title?: unknown;
  pillar?: unknown;
  minAge?: unknown;
  maxAge?: unknown;
  difficulty?: unknown;
  estimatedMinutes?: unknown;
  popularity?: unknown;
};

function parseAge(value: unknown, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(18, Math.max(0, Math.trunc(value)));
}

export async function POST(request: NextRequest) {
  const gate = requireSupport(request);
  if (gate.error) {
    return gate.error;
  }
  let body: CreateSuggestionBody;
  try {
    body = (await request.json()) as CreateSuggestionBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 160) : "";
  if (!title) {
    return NextResponse.json({ error: "title_required" }, { status: 400 });
  }
  const minAge = parseAge(body.minAge, 0);
  const maxAge = Math.max(minAge, parseAge(body.maxAge, 18));
  const now = new Date().toISOString();
  try {
    const id = randomUUID();
    await adminCreateDocument(CHORE_SUGGESTIONS_COLLECTION, id, {
      title: stringField(title),
      pillar: stringField(normalizeResponsibilityPillar(body.pillar)),
      minAge: integerField(minAge),
      maxAge: integerField(maxAge),
      difficulty: stringField(normalizeSuggestionDifficulty(body.difficulty)),
      estimatedMinutes: integerField(
        typeof body.estimatedMinutes === "number" && Number.isFinite(body.estimatedMinutes)
          ? Math.max(0, Math.trunc(body.estimatedMinutes))
          : 0,
      ),
      popularity: integerField(
        typeof body.popularity === "number" && Number.isFinite(body.popularity)
          ? Math.max(0, Math.trunc(body.popularity))
          : 0,
      ),
      active: boolField(true),
      createdBy: stringField(gate.session.uid),
      createdAt: timestampField(now),
      updatedAt: timestampField(now),
    });
    return NextResponse.json({ success: true, suggestionId: id });
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 180) : "unknown";
    console.error("[SUPPORT_SUGGESTIONS_POST_ERROR]", reason);
    return NextResponse.json({ error: "create_suggestion_failed" }, { status: 500 });
  }
}
