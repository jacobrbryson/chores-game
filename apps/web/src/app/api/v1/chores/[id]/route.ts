import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const upstream = await proxyJson(request, `/api/chores/${id}`);
  if (upstream.status >= 400) {
    return fail(String(upstream.json?.error ?? "upstream_error"), "Failed to fetch chore", upstream.status, upstream.json);
  }
  return ok(upstream.json);
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const upstream = await proxyJson(request, `/api/chores/${id}`, { method: "PATCH" });
  if (upstream.status >= 400) {
    return fail(String(upstream.json?.error ?? "upstream_error"), "Failed to update chore", upstream.status, upstream.json);
  }
  return ok(upstream.json);
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const upstream = await proxyJson(request, `/api/chores/${id}`, { method: "DELETE" });
  if (upstream.status >= 400) {
    return fail(String(upstream.json?.error ?? "upstream_error"), "Failed to delete chore", upstream.status, upstream.json);
  }
  return ok(upstream.json);
}
