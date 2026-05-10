import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const upstream = await proxyJson(request, `/api/quests/${id}`);
  if (upstream.status >= 400) {
    return fail(String(upstream.json?.error ?? "upstream_error"), "Failed to get quest", upstream.status, upstream.json);
  }
  return ok(upstream.json);
}
