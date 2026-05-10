import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

export async function GET(request: NextRequest) {
  const upstream = await proxyJson(request, "/api/family/summary");
  if (upstream.status >= 400) {
    return fail(String(upstream.json?.error ?? "upstream_error"), "Failed to fetch family", upstream.status, upstream.json);
  }
  const payload = {
    family: upstream.json.family ?? null,
    members: upstream.json.members ?? [],
    noFamily: Boolean(upstream.json.noFamily),
  };
  return ok(payload);
}
