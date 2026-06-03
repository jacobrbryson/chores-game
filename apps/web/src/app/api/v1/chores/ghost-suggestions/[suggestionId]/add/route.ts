import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ suggestionId: string }> },
) {
  const { suggestionId } = await params;
  const upstream = await proxyJson(
    request,
    `/api/chores/ghost-suggestions/${encodeURIComponent(suggestionId)}/add`,
  );
  if (upstream.status >= 400) {
    return fail(
      String(upstream.json?.error ?? "upstream_error"),
      "Failed to add ghost chore",
      upstream.status,
      upstream.json,
    );
  }
  return ok(upstream.json);
}
