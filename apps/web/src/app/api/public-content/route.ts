import { NextRequest, NextResponse } from "next/server";
import { listPublishedPublicContent } from "@/lib/public-content/service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const result = await listPublishedPublicContent({
      type: params.get("type") ?? "",
      tag: params.get("tag") ?? "",
      category: params.get("category") ?? "",
      locale: params.get("locale") ?? "",
      page: Number(params.get("page") ?? "1"),
      limit: Number(params.get("limit") ?? "25"),
      sort: params.get("sort") ?? "publishedAt",
    });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=300" },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.error("[PUBLIC_CONTENT_LIST_ERROR]", reason.slice(0, 240));
    return NextResponse.json({ error: "public_content_unavailable" }, { status: 500 });
  }
}
