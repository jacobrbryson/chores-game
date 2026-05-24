import { NextRequest, NextResponse } from "next/server";
import { getPlayerChoresToday } from "@/lib/public-api/data";
import { publicApiError, withPublicApi } from "@/lib/public-api/middleware";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ playerId: string }> },
) {
  const { playerId } = await context.params;
  return withPublicApi(request, ["read:chores"], async ({ requestId, rateLimit, token }) => {
    const result = await getPlayerChoresToday(token, playerId);
    if (result.status === "not_found") {
      return publicApiError("not_found", "Player not found.", 404, requestId, rateLimit);
    }
    if (result.status === "permission_denied") {
      return publicApiError("forbidden", "Player is not visible to this API token.", 403, requestId, rateLimit);
    }
    return NextResponse.json({ playerId, chores: result.data });
  });
}
