import { NextRequest } from "next/server";
import { fail, ok, proxyJsonWithCookies } from "@/app/api/v1/_lib/response";

// Mobile proxy for "Start Kiosk Mode" — enter a shared-tablet kiosk session for
// the selected roster of players. Forwards the rotated session cookie back.
export async function POST(request: NextRequest) {
  const upstream = await proxyJsonWithCookies(request, "/api/kiosk/start");
  const response =
    upstream.status >= 400
      ? fail(
          String(upstream.json?.error ?? "kiosk_start_failed"),
          "Failed to start Kiosk Mode",
          upstream.status,
          upstream.json,
        )
      : ok({ success: true });
  for (const cookie of upstream.setCookies) {
    response.headers.append("set-cookie", cookie);
  }
  return response;
}
