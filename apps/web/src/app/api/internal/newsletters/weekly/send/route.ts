import { NextRequest, NextResponse } from "next/server";
import { sendWeeklyFamilyHighlightsForAllFamilies } from "@/lib/newsletters/service";

export const runtime = "nodejs";

function hasValidInternalSecret(request: NextRequest) {
  const expected = process.env.NEWSLETTER_INTERNAL_SECRET?.trim() ?? "";
  if (!expected) {
    throw new Error("NEWSLETTER_INTERNAL_SECRET_MISSING");
  }
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const headerSecret = request.headers.get("x-internal-secret")?.trim() ?? "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  return bearer === expected || headerSecret === expected;
}

export async function POST(request: NextRequest) {
  try {
    if (!hasValidInternalSecret(request)) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const result = await sendWeeklyFamilyHighlightsForAllFamilies();
    return NextResponse.json(result);
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 240) : "unknown";
    console.error("[INTERNAL_WEEKLY_NEWSLETTER_SEND_ERROR]", reason);
    return NextResponse.json({ error: "weekly_newsletter_send_failed" }, { status: 500 });
  }
}
