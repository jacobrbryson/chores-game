import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

// Native push registration for the Expo app: the device posts its Expo push
// token here after the user grants notification permission.
export async function GET(request: NextRequest) {
  const upstream = await proxyJson(request, "/api/push-devices");
  if (upstream.status >= 400) {
    return fail(
      String(upstream.json?.error ?? "upstream_error"),
      "Failed to load push devices",
      upstream.status,
      upstream.json,
    );
  }
  return ok(upstream.json);
}

export async function POST(request: NextRequest) {
  const upstream = await proxyJson(request, "/api/push-devices", { method: "POST" });
  if (upstream.status >= 400) {
    return fail(
      String(upstream.json?.error ?? "upstream_error"),
      "Failed to register push device",
      upstream.status,
      upstream.json,
    );
  }
  return ok(upstream.json);
}

export async function DELETE(request: NextRequest) {
  const upstream = await proxyJson(request, "/api/push-devices", { method: "DELETE" });
  if (upstream.status >= 400) {
    return fail(
      String(upstream.json?.error ?? "upstream_error"),
      "Failed to remove push device",
      upstream.status,
      upstream.json,
    );
  }
  return ok(upstream.json);
}
