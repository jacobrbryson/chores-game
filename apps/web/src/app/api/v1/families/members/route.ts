import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

// Invite / add a family member from the mobile Manage Family screen.
// Role and validation rules are enforced upstream in /api/family/members.
export async function POST(request: NextRequest) {
  const upstream = await proxyJson(request, "/api/family/members", { method: "POST" });
  if (upstream.status >= 400) {
    return fail(
      String(upstream.json?.error ?? "upstream_error"),
      "Failed to add family member",
      upstream.status,
      upstream.json,
    );
  }
  return ok(upstream.json, 201);
}
