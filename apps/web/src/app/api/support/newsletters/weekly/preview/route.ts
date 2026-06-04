import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { buildWeeklyFamilyHighlightsPreview } from "@/lib/newsletters/service";
import { isSupportAdmin } from "@/lib/support/access";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isSupportAdmin(session)) {
    return NextResponse.json({ error: "support_admin_required" }, { status: 403 });
  }
  const familyId = request.nextUrl.searchParams.get("familyId")?.trim() ?? "";
  if (!familyId) {
    return NextResponse.json({ error: "family_id_required" }, { status: 400 });
  }

  try {
    const preview = await buildWeeklyFamilyHighlightsPreview({ familyId });
    return NextResponse.json(preview);
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 240) : "unknown";
    console.error("[SUPPORT_WEEKLY_NEWSLETTER_PREVIEW_ERROR]", reason);
    return NextResponse.json({ error: "weekly_newsletter_preview_unavailable" }, { status: 500 });
  }
}
