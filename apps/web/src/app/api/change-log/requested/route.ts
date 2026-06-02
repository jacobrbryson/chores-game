import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { loadPublicRequestedChanges } from "@/lib/support/public-requests";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  const searchParams = request.nextUrl.searchParams;

  try {
    const result = await loadPublicRequestedChanges({
      page: Number(searchParams.get("page") ?? "1"),
      limit: Number(searchParams.get("limit") ?? "20"),
      status: searchParams.get("status") ?? "all",
      type: searchParams.get("type") ?? "all",
      sort: searchParams.get("sort") ?? "newest",
      viewerUid: session?.uid ?? "",
    });
    return NextResponse.json(result);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.error("[PUBLIC_REQUESTED_CHANGES_ERROR]", reason.slice(0, 240));
    return NextResponse.json({ error: "requested_changes_unavailable" }, { status: 500 });
  }
}

