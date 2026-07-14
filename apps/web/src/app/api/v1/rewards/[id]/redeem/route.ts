import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  let body: { recipientMemberId?: unknown; consumeReward?: unknown } = {};
  try {
    body = await request.clone().json();
  } catch {
    // The existing mobile contract allows an empty request body.
  }
  const upstream = await proxyJson(request, "/api/store", {
    method: "POST",
    body: JSON.stringify({
      action: "purchase_option",
      categoryId: "family_awards",
      optionId: id,
      recipientMemberId: body.recipientMemberId,
      consumeReward: body.consumeReward === true,
    }),
  });
  if (upstream.status >= 400) {
    return fail(String(upstream.json?.error ?? "upstream_error"), "Failed to redeem reward", upstream.status, upstream.json);
  }
  return ok({ id, redeemed: true });
}
