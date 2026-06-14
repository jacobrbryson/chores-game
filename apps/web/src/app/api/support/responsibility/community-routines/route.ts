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
  COMMUNITY_ROUTINES_COLLECTION,
  communityRoutineFromDoc,
} from "@/lib/responsibility/catalog";
import { normalizeRoutineSteps } from "@/lib/responsibility/routines";
import { normalizeResponsibilityPillar } from "@/lib/responsibility/types";

export const runtime = "nodejs";

// Community routine library management: list all entries (every status) and
// seed new ones. Parent-facing publishing is intentionally not exposed yet —
// support curates the library until the community workflow ships.
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isSupportAdmin(session)) {
    return NextResponse.json({ error: "support_admin_required" }, { status: 403 });
  }
  try {
    const docs = await adminListAllDocuments(COMMUNITY_ROUTINES_COLLECTION, { cap: 500 });
    const routines = docs
      .map((doc) => communityRoutineFromDoc(doc))
      .sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ routines });
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 180) : "unknown";
    console.error("[SUPPORT_COMMUNITY_ROUTINES_GET_ERROR]", reason);
    return NextResponse.json({ error: "community_routines_unavailable" }, { status: 500 });
  }
}

type CreateCommunityRoutineBody = {
  name?: unknown;
  pillar?: unknown;
  steps?: unknown;
  minAge?: unknown;
  maxAge?: unknown;
  status?: unknown;
  featured?: unknown;
};

function parseAge(value: unknown, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(18, Math.max(0, Math.trunc(value)));
}

export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isSupportAdmin(session)) {
    return NextResponse.json({ error: "support_admin_required" }, { status: 403 });
  }
  let body: CreateCommunityRoutineBody;
  try {
    body = (await request.json()) as CreateCommunityRoutineBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  if (!name) {
    return NextResponse.json({ error: "name_required" }, { status: 400 });
  }
  const steps = normalizeRoutineSteps(body.steps);
  if (!steps) {
    return NextResponse.json({ error: "routine_steps_invalid" }, { status: 400 });
  }
  const minAge = parseAge(body.minAge, 0);
  const maxAge = Math.max(minAge, parseAge(body.maxAge, 18));
  const status =
    body.status === "approved" || body.status === "rejected" ? body.status : "pending";
  const now = new Date().toISOString();
  try {
    const id = randomUUID();
    await adminCreateDocument(COMMUNITY_ROUTINES_COLLECTION, id, {
      name: stringField(name),
      pillar: stringField(normalizeResponsibilityPillar(body.pillar)),
      stepsJson: stringField(JSON.stringify(steps)),
      minAge: integerField(minAge),
      maxAge: integerField(maxAge),
      status: stringField(status),
      featured: boolField(body.featured === true),
      submittedBy: stringField(session.uid),
      createdAt: timestampField(now),
      updatedAt: timestampField(now),
    });
    return NextResponse.json({ success: true, routineId: id });
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 180) : "unknown";
    console.error("[SUPPORT_COMMUNITY_ROUTINES_POST_ERROR]", reason);
    return NextResponse.json({ error: "create_community_routine_failed" }, { status: 500 });
  }
}
