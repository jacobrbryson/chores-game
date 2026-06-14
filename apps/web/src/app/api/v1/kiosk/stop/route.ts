import { NextRequest } from "next/server";
import { fail, ok, proxyJsonWithCookies } from "@/app/api/v1/_lib/response";

// Mobile proxy for "Exit Kiosk Mode" — return to the original signed-in account.
export async function POST(request: NextRequest) {
  const upstream = await proxyJsonWithCookies(request, "/api/kiosk/stop");
  const response =
    upstream.status >= 400
      ? fail(
          String(upstream.json?.error ?? "kiosk_stop_failed"),
          "Failed to exit Kiosk Mode",
          upstream.status,
          upstream.json,
        )
      : ok({ success: true });
  for (const cookie of upstream.setCookies) {
    response.headers.append("set-cookie", cookie);
  }
  return response;
}
