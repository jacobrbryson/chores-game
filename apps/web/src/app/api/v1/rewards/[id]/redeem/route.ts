import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const upstream = await proxyJson(request, "/api/store", {
    method: "POST",
    body: JSON.stringify({ action: "purchase_option", categoryId: "family_awards", optionId: id }),
  });
  if (upstream.status >= 400) {
    return fail(String(upstream.json?.error ?? "upstream_error"), "Failed to redeem reward", upstream.status, upstream.json);
  }
  return ok({ id, redeemed: true });
}
