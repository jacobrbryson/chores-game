import { NextRequest } from "next/server";
import { fail, ok, proxyJsonWithCookies } from "@/app/api/v1/_lib/response";

// Mobile proxy for the Kiosk Mode status probe. Used to decide whether to show
// the "Kiosk Mode" entry and whether a PIN is required to start/exit.
export async function GET(request: NextRequest) {
  const upstream = await proxyJsonWithCookies(request, "/api/kiosk");
  const response =
    upstream.status >= 400
      ? fail(
          String(upstream.json?.error ?? "kiosk_status_failed"),
          "Failed to load Kiosk Mode status",
          upstream.status,
          upstream.json,
        )
      : ok({
          active: Boolean(upstream.json?.active),
          inFamily: Boolean(upstream.json?.inFamily),
          pinRequired: Boolean(upstream.json?.pinRequired),
          playerIds: Array.isArray(upstream.json?.playerIds) ? upstream.json.playerIds : [],
          authenticatedName: typeof upstream.json?.authenticatedName === "string" ? upstream.json.authenticatedName : "",
        });
  for (const cookie of upstream.setCookies) {
    response.headers.append("set-cookie", cookie);
  }
  return response;
}
