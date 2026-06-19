import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import {
  AthenaIntegrationError,
  suggestChoresWithAthena,
  type AthenaChoreSuggestion,
} from "@/lib/integrations/athena";

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

type SuggestBody = {
  child?: { displayName?: unknown; age?: unknown; interests?: unknown };
  existingChores?: unknown;
  count?: unknown;
  context?: unknown;
};

function toExistingChores(value: unknown): Array<{ title: string; coinValue?: number }> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const title = typeof (entry as { title?: unknown }).title === "string"
        ? ((entry as { title: string }).title).slice(0, 200)
        : "";
      if (!title) {
        return null;
      }
      const rawCoin = (entry as { coinValue?: unknown }).coinValue;
      const coinValue = typeof rawCoin === "number" && Number.isFinite(rawCoin) ? rawCoin : undefined;
      return coinValue === undefined ? { title } : { title, coinValue };
    })
    .filter((entry): entry is { title: string; coinValue?: number } => entry !== null)
    .slice(0, 100);
}

/**
 * POST — fetch Athena/Gemini chore suggestions. Athena only suggests; it never
 * creates chores. Parent/admin only. Stateless (no connection required, the
 * partner secret authorizes it server-side).
 */
export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return unauthorized();
  }
  if (session.role !== "admin") {
    return NextResponse.json(
      { error: "forbidden", message: "Only a parent or admin can use Athena suggestions." },
      { status: 403 },
    );
  }

  let body: SuggestBody;
  try {
    body = (await request.json()) as SuggestBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const displayName =
    typeof body.child?.displayName === "string" ? body.child.displayName.trim().slice(0, 80) : "";
  if (!displayName) {
    return NextResponse.json(
      { error: "invalid_request", message: "A child name is required to get suggestions." },
      { status: 400 },
    );
  }

  const age = typeof body.child?.age === "number" && Number.isFinite(body.child.age)
    ? Math.max(1, Math.min(18, Math.trunc(body.child.age)))
    : undefined;
  const interests = Array.isArray(body.child?.interests)
    ? body.child.interests.filter((entry): entry is string => typeof entry === "string").slice(0, 20)
    : undefined;
  const count = typeof body.count === "number" && Number.isFinite(body.count)
    ? Math.max(1, Math.min(10, Math.trunc(body.count)))
    : undefined;
  const context = typeof body.context === "string" ? body.context.trim().slice(0, 500) : undefined;

  try {
    const result = await suggestChoresWithAthena({
      child: { displayName, age, interests },
      existingChores: toExistingChores(body.existingChores),
      count,
      context,
    });
    const suggestions: AthenaChoreSuggestion[] = Array.isArray(result.suggestions)
      ? result.suggestions
      : [];
    return NextResponse.json({ success: true, suggestions });
  } catch (error) {
    if (error instanceof AthenaIntegrationError) {
      if (error.code === "config_error") {
        console.error("[ATHENA_SUGGEST_CONFIG_ERROR]", error.message);
      }
      // Both the partner-secret (401) and AI-unavailable (502) cases surface the
      // same friendly retry copy on the chores screen.
      const message =
        error.code === "invalid_request" || error.code === "forbidden"
          ? error.userMessage
          : "Couldn't get suggestions, try again.";
      return NextResponse.json({ error: error.code, message }, { status: error.status });
    }
    throw error;
  }
}
