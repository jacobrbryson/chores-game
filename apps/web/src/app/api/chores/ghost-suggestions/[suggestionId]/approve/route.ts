import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import {
  approveGhostSuggestion,
  resolveGhostViewerContext,
} from "@/lib/ghost-chores-service";

export const runtime = "nodejs";

type ApproveBody = {
  assigneeId?: unknown;
  assigneeName?: unknown;
  title?: unknown;
  details?: unknown;
  coinValue?: unknown;
  requireApproval?: unknown;
  dueDate?: unknown;
  categoryIds?: unknown;
};

function asString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ suggestionId: string }> },
) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { suggestionId } = await params;
  if (!suggestionId) {
    return NextResponse.json({ error: "suggestion_id_required" }, { status: 400 });
  }

  let body: ApproveBody = {};
  try {
    body = (await request.json()) as ApproveBody;
  } catch {
    body = {};
  }

  try {
    const context = await resolveGhostViewerContext({
      uid: session.uid,
      memberId: session.memberId,
      email: session.email,
    });
    if (!context) {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    if (context.role !== "admin") {
      return NextResponse.json({ error: "forbidden_action" }, { status: 403 });
    }

    const result = await approveGhostSuggestion({
      familyId: context.familyId,
      suggestionId,
      reviewerUid: session.uid,
      reviewerName: session.name || session.email,
      reviewerEmail: session.email,
      overrides: {
        assigneeId: asString(body.assigneeId),
        assigneeName: asString(body.assigneeName),
        title: asString(body.title),
        details: asString(body.details),
        coinValue: typeof body.coinValue === "number" ? body.coinValue : undefined,
        requireApproval: typeof body.requireApproval === "boolean" ? body.requireApproval : undefined,
        dueDate: asString(body.dueDate),
        categoryIds: Array.isArray(body.categoryIds)
          ? body.categoryIds.filter((id): id is string => typeof id === "string")
          : undefined,
      },
    });
    if (!result.ok) {
      const status = result.error === "not_found" ? 404 : 409;
      return NextResponse.json({ error: result.error }, { status });
    }

    return NextResponse.json({ success: true, choreId: result.choreId }, { status: 201 });
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 180) : "unknown";
    console.error("[GHOST_SUGGESTION_APPROVE_ERROR]", reason);
    return NextResponse.json({ error: "ghost_approve_failed" }, { status: 500 });
  }
}
