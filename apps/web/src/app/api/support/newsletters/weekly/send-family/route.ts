import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { sendWeeklyFamilyHighlightsForFamily } from "@/lib/newsletters/service";
import { isSupportAdmin } from "@/lib/support/access";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isSupportAdmin(session)) {
    return NextResponse.json({ error: "support_admin_required" }, { status: 403 });
  }

  let body: { familyId?: unknown };
  try {
    body = (await request.json()) as { familyId?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const familyId = typeof body.familyId === "string" ? body.familyId.trim() : "";
  if (!familyId) {
    return NextResponse.json({ error: "family_id_required" }, { status: 400 });
  }

  try {
    const result = await sendWeeklyFamilyHighlightsForFamily({ familyId });
    return NextResponse.json({
      success: true,
      sent: result.sent,
      skipped: result.skipped,
      failed: result.failed,
      lastSentAt: result.lastSentAt,
      records: result.records,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 240) : "unknown";
    console.error("[SUPPORT_WEEKLY_NEWSLETTER_SEND_FAMILY_ERROR]", reason);
    return NextResponse.json({ error: "weekly_newsletter_send_failed" }, { status: 500 });
  }
}
