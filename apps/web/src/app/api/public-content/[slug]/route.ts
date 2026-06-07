import { NextRequest, NextResponse } from "next/server";
import { getPublishedContentBySlug } from "@/lib/public-content/service";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { slug } = await context.params;
  try {
    const content = await getPublishedContentBySlug(slug, request.nextUrl.searchParams.get("type") ?? "");
    if (!content) return NextResponse.json({ error: "content_not_found" }, { status: 404 });
    return NextResponse.json({ content }, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=300" },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.error("[PUBLIC_CONTENT_DETAIL_ERROR]", reason.slice(0, 240));
    return NextResponse.json({ error: "public_content_unavailable" }, { status: 500 });
  }
}
