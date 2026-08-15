import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

// Edit / disable / enable a Family Award. `disabled` toggles availability in the
// store without deleting the award or its redemption history.
export async function PATCH(request: NextRequest, context: { params: Promise<{ rewardId: string }> }) {
  const { rewardId } = await context.params;
  const upstream = await proxyJson(request, `/api/family/rewards/${rewardId}`, { method: "PATCH" });
  if (upstream.status >= 400) {
    return fail(
      String(upstream.json?.error ?? "upstream_error"),
      "Failed to update family award",
      upstream.status,
      upstream.json,
    );
  }
  return ok(upstream.json);
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ rewardId: string }> }) {
  const { rewardId } = await context.params;
  const upstream = await proxyJson(request, `/api/family/rewards/${rewardId}`, { method: "DELETE" });
  if (upstream.status >= 400) {
    return fail(
      String(upstream.json?.error ?? "upstream_error"),
      "Failed to delete family award",
      upstream.status,
      upstream.json,
    );
  }
  return ok(upstream.json);
}
