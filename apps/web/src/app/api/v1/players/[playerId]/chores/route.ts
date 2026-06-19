import { NextRequest, NextResponse } from "next/server";
import { getPlayerChores, type PlayerChoresQuery } from "@/lib/public-api/data";
import { publicApiError, withPublicApi } from "@/lib/public-api/middleware";

function parseRange(value: string | null): PlayerChoresQuery["range"] | undefined {
  switch (value) {
    case "today":
    case "tomorrow":
    case "yesterday":
    case "this-week":
    case "last-week":
    case "upcoming":
    case "all":
      return value;
    default:
      return undefined;
  }
}

function parseStatus(value: string | null): PlayerChoresQuery["status"] | undefined {
  if (value === "open" || value === "completed" || value === "all") {
    return value;
  }
  return undefined;
}

function parseBool(value: string | null): boolean | undefined {
  if (value === "true" || value === "1") {
    return true;
  }
  if (value === "false" || value === "0") {
    return false;
  }
  return undefined;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ playerId: string }> },
) {
  const { playerId } = await context.params;
  const params = request.nextUrl.searchParams;
  const query: PlayerChoresQuery = {
    range: parseRange(params.get("range")),
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    status: parseStatus(params.get("status")),
    category: params.get("category") ?? undefined,
    includeRecurring: parseBool(params.get("includeRecurring")),
  };

  return withPublicApi(request, ["read:chores"], async ({ requestId, rateLimit, token }) => {
    const result = await getPlayerChores(token, playerId, query);
    if (result.status === "not_found") {
      return publicApiError("not_found", "Player not found.", 404, requestId, rateLimit);
    }
    if (result.status === "permission_denied") {
      return publicApiError(
        "forbidden",
        "Player is not visible to this API token.",
        403,
        requestId,
        rateLimit,
      );
    }
    return NextResponse.json(result.data);
  });
}
