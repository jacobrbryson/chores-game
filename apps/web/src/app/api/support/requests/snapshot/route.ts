import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { isSupportAdmin } from "@/lib/support/access";
import { writePublicRequestedChangesSnapshot } from "@/lib/support/public-requests-snapshot";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isSupportAdmin(session)) {
    return NextResponse.json({ error: "support_admin_required" }, { status: 403 });
  }

  try {
    await writePublicRequestedChangesSnapshot();
    return NextResponse.json({ ok: true });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.error("[SNAPSHOT_REBUILD_ERROR]", reason.slice(0, 240));
    return NextResponse.json({ error: "snapshot_rebuild_failed", detail: reason.slice(0, 200) }, { status: 500 });
  }
}
