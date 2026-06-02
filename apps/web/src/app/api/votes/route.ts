import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { writePublicRequestedChangesSnapshotBestEffort } from "@/lib/support/public-requests-snapshot";
import { toggleVote } from "@/lib/voting/service";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const candidate = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  try {
    const result = await toggleVote({
      targetType: candidate.targetType,
      targetId: candidate.targetId,
      value: candidate.value,
      uid: session.uid,
      familyId: null,
    });
    if (!result.ok) {
      const status = result.error === "target_not_found" ? 404 : 400;
      return NextResponse.json({ error: result.error }, { status });
    }
    await writePublicRequestedChangesSnapshotBestEffort();
    return NextResponse.json(result);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.error("[VOTE_TOGGLE_ERROR]", reason.slice(0, 240));
    return NextResponse.json({ error: "vote_failed" }, { status: 500 });
  }
}
