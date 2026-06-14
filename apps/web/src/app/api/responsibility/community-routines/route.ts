import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { adminListAllDocuments } from "@/lib/firestore/admin";
import {
  COMMUNITY_ROUTINES_COLLECTION,
  communityRoutineFromDoc,
} from "@/lib/responsibility/catalog";
import { normalizeResponsibilityPillar } from "@/lib/responsibility/types";

export const runtime = "nodejs";

// Approved community routine library for families to browse. Only approved
// entries are exposed here; the moderation queue lives under /api/support.
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const pillar = normalizeResponsibilityPillar(params.get("pillar") ?? "");
  const featuredOnly = params.get("featured") === "1";
  const ageRaw = Number(params.get("age"));
  const age = Number.isFinite(ageRaw) && ageRaw > 0 ? Math.trunc(ageRaw) : undefined;

  try {
    const docs = await adminListAllDocuments(COMMUNITY_ROUTINES_COLLECTION, { cap: 500 });
    const routines = docs
      .map((doc) => communityRoutineFromDoc(doc))
      .filter((routine) => routine.status === "approved")
      .filter((routine) => !featuredOnly || routine.featured)
      .filter((routine) => !pillar || routine.pillar === pillar)
      .filter(
        (routine) => age === undefined || (age >= routine.minAge && age <= routine.maxAge),
      )
      .sort(
        (a, b) =>
          Number(b.featured) - Number(a.featured) || a.name.localeCompare(b.name),
      );
    return NextResponse.json({ routines });
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 180) : "unknown";
    console.error("[COMMUNITY_ROUTINES_GET_ERROR]", reason);
    return NextResponse.json({ error: "community_routines_unavailable" }, { status: 500 });
  }
}
