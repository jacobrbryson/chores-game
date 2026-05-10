import { NextRequest } from "next/server";
import { fail, ok, proxyJson, toPaginated } from "@/app/api/v1/_lib/response";

export async function GET(request: NextRequest) {
  const upstream = await proxyJson(request, "/api/store");
  if (upstream.status >= 400) {
    return fail(String(upstream.json?.error ?? "upstream_error"), "Failed to list rewards", upstream.status, upstream.json);
  }
  const familyAwards = (upstream.json.categories ?? []).find((c: { id?: string }) => c.id === "family_awards");
  return ok(toPaginated((familyAwards?.options ?? []).map((option: any) => ({
    id: option.id,
    title: option.label,
    coinCost: option.price,
    imageId: option.value,
    available: true,
  }))));
}
