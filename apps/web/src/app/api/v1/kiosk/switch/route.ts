import { NextRequest } from "next/server";
import { fail, ok, proxyJsonWithCookies } from "@/app/api/v1/_lib/response";

// Mobile proxy for switching the active kiosk player within the approved roster.
// No PIN required (the roster was approved when Kiosk Mode started).
export async function POST(request: NextRequest) {
  const upstream = await proxyJsonWithCookies(request, "/api/kiosk/switch");
  const response =
    upstream.status >= 400
      ? fail(
          String(upstream.json?.error ?? "kiosk_switch_failed"),
          "Failed to switch kiosk player",
          upstream.status,
          upstream.json,
        )
      : ok({ success: true });
  for (const cookie of upstream.setCookies) {
    response.headers.append("set-cookie", cookie);
  }
  return response;
}
