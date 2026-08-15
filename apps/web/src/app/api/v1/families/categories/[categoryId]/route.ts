import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

export async function PATCH(request: NextRequest, context: { params: Promise<{ categoryId: string }> }) {
  const { categoryId } = await context.params;
  const upstream = await proxyJson(request, `/api/family/categories/${categoryId}`, { method: "PATCH" });
  if (upstream.status >= 400) {
    return fail(
      String(upstream.json?.error ?? "upstream_error"),
      "Failed to update category",
      upstream.status,
      upstream.json,
    );
  }
  return ok(upstream.json);
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ categoryId: string }> }) {
  const { categoryId } = await context.params;
  const upstream = await proxyJson(request, `/api/family/categories/${categoryId}`, { method: "DELETE" });
  if (upstream.status >= 400) {
    return fail(
      String(upstream.json?.error ?? "upstream_error"),
      "Failed to delete category",
      upstream.status,
      upstream.json,
    );
  }
  return ok(upstream.json);
}
