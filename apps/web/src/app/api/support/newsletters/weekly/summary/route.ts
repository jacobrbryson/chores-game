import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { loadWeeklyNewsletterSupportSummary } from "@/lib/newsletters/service";
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

  try {
    const summary = await loadWeeklyNewsletterSupportSummary();
    return NextResponse.json(summary);
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 240) : "unknown";
    console.error("[SUPPORT_WEEKLY_NEWSLETTER_SUMMARY_ERROR]", reason);
    return NextResponse.json({ error: "weekly_newsletter_summary_unavailable" }, { status: 500 });
  }
}
