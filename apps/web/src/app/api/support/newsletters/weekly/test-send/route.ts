import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { sendWeeklyFamilyHighlightsTest } from "@/lib/newsletters/service";
import { isSupportAdmin } from "@/lib/support/access";

export const runtime = "nodejs";

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isSupportAdmin(session)) {
    return NextResponse.json({ error: "support_admin_required" }, { status: 403 });
  }
  if (!isValidEmail(session.email)) {
    return NextResponse.json({ error: "support_admin_email_required" }, { status: 400 });
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
    const result = await sendWeeklyFamilyHighlightsTest({
      familyId,
      recipientEmail: session.email,
      recipientLocale: session.locale,
    });
    return NextResponse.json({
      success: true,
      provider: result.provider,
      providerMessageId: result.providerMessageId,
      recipientEmail: session.email,
      subject: result.preview.rendered.subject,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 240) : "unknown";
    console.error("[SUPPORT_WEEKLY_NEWSLETTER_TEST_SEND_ERROR]", reason);
    return NextResponse.json({ error: "weekly_newsletter_test_send_failed" }, { status: 500 });
  }
}
