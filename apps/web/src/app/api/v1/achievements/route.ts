import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

export async function GET(request: NextRequest) {
  // `mode=listener` asks for just the realtime handshake (ws token, viewer uid,
  // family id) instead of the full board. Forward it so the mobile unlock
  // listener can bootstrap the same way the web listener does.
  const listenerMode = request.nextUrl.searchParams.get("mode") === "listener";
  const upstream = await proxyJson(
    request,
    listenerMode ? "/api/achievements?mode=listener" : "/api/achievements",
  );
  if (upstream.status >= 400) {
    return fail(String(upstream.json?.error ?? "upstream_error"), "Failed to list achievements", upstream.status, upstream.json);
  }
  const achievements = upstream.json.achievements ?? [];
  return ok({
    ...upstream.json,
    items: achievements,
    pagination: {
      page: 1,
      pageSize: achievements.length,
      total: achievements.length,
      totalPages: 1,
    },
  });
}
