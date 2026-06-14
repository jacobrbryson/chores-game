import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { adminListAllDocuments } from "@/lib/firestore/admin";
import {
  CHORE_SUGGESTIONS_COLLECTION,
  choreSuggestionFromDoc,
  filterChoreSuggestions,
  normalizeSuggestionDifficulty,
} from "@/lib/responsibility/catalog";
import { normalizeResponsibilityPillar } from "@/lib/responsibility/types";

export const runtime = "nodejs";

// Curated chore suggestions, filterable by pillar, age, difficulty, and
// estimated time. Session-gated; reads use admin credentials because the
// catalog is platform-wide curated content, not family data.
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const pillar = normalizeResponsibilityPillar(params.get("pillar") ?? "");
  const ageRaw = Number(params.get("age"));
  const maxMinutesRaw = Number(params.get("maxMinutes"));
  const difficultyRaw = params.get("difficulty") ?? "";
  const difficulty =
    difficultyRaw === "easy" || difficultyRaw === "medium" || difficultyRaw === "hard"
      ? normalizeSuggestionDifficulty(difficultyRaw)
      : "";

  try {
    const docs = await adminListAllDocuments(CHORE_SUGGESTIONS_COLLECTION, { cap: 500 });
    const suggestions = filterChoreSuggestions(
      docs.map((doc) => choreSuggestionFromDoc(doc)),
      {
        pillar,
        age: Number.isFinite(ageRaw) && ageRaw > 0 ? Math.trunc(ageRaw) : undefined,
        difficulty,
        maxMinutes:
          Number.isFinite(maxMinutesRaw) && maxMinutesRaw > 0
            ? Math.trunc(maxMinutesRaw)
            : undefined,
      },
    );
    return NextResponse.json({ suggestions });
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 180) : "unknown";
    console.error("[RESPONSIBILITY_SUGGESTIONS_GET_ERROR]", reason);
    return NextResponse.json({ error: "suggestions_unavailable" }, { status: 500 });
  }
}
