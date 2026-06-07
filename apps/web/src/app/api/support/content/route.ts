import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { isSupportAdmin } from "@/lib/support/access";
import {
  createPublicContent,
  getSeoIssues,
  listPublicContentRecords,
  summarizeSeo,
} from "@/lib/public-content/service";
import type { PublicContentInput } from "@/lib/public-content/types";

export const runtime = "nodejs";

function requireSupport(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) return { ok: false as const, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  if (!isSupportAdmin(session)) return { ok: false as const, response: NextResponse.json({ error: "support_admin_required" }, { status: 403 }) };
  return { ok: true as const, session };
}

export async function GET(request: NextRequest) {
  const support = requireSupport(request);
  if (!support.ok) return support.response;

  try {
    const params = request.nextUrl.searchParams;
    const result = await listPublicContentRecords({
      type: params.get("type") ?? "",
      status: params.get("status") ?? "",
      q: params.get("q") ?? "",
      missingSeo: params.get("missingSeo") === "true",
      page: Number(params.get("page") ?? "1"),
      limit: Number(params.get("limit") ?? "25"),
      sort: params.get("sort") ?? "updatedAt",
      locale: params.get("locale") ?? "",
    });
    return NextResponse.json({
      content: result.records.map((record) => ({ ...record, seoIssues: getSeoIssues(record) })),
      pagination: result.pagination,
      seo: summarizeSeo(result.allRecords),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.error("[SUPPORT_CONTENT_LIST_ERROR]", reason.slice(0, 240));
    return NextResponse.json({ error: "support_content_unavailable" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const support = requireSupport(request);
  if (!support.ok) return support.response;

  let body: PublicContentInput;
  try {
    body = (await request.json()) as PublicContentInput;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    const result = await createPublicContent(body, support.session);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ content: result.record }, { status: 201 });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.error("[SUPPORT_CONTENT_CREATE_ERROR]", reason.slice(0, 240));
    return NextResponse.json({ error: "support_content_create_failed" }, { status: 500 });
  }
}
