import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ communityAwardId: string }> },
) {
  const { communityAwardId } = await context.params;
  if (!communityAwardId) {
    return fail("community_award_id_required", "Community award ID is required", 400);
  }

  const upstream = await proxyJson(
    request,
    `/api/community/awards/${encodeURIComponent(communityAwardId)}/copy`,
    { method: "POST", body: "{}" },
  );
  if (upstream.status >= 400) {
    return fail(
      String(upstream.json?.error ?? "upstream_error"),
      "Failed to copy community award",
      upstream.status,
      upstream.json,
    );
  }
  return ok(upstream.json ?? {}, upstream.status);
}
