import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const upstream = await proxyJson(request, `/api/quests/${id}/choose`, { method: "POST" });
  if (upstream.status >= 400) {
    return fail(String(upstream.json?.error ?? "upstream_error"), "Failed to submit quest choice", upstream.status, upstream.json);
  }
  return ok(upstream.json);
}
