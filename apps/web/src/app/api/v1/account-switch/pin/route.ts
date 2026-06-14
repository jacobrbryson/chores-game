import { NextRequest } from "next/server";
import { fail, ok, proxyJsonWithCookies } from "@/app/api/v1/_lib/response";

// Mobile proxy for guardian PIN setup, used before the first account switch.
export async function POST(request: NextRequest) {
  const upstream = await proxyJsonWithCookies(request, "/api/account-switch/pin");
  const response =
    upstream.status >= 400
      ? fail(
          String(upstream.json?.error ?? "pin_update_failed"),
          "Failed to set guardian PIN",
          upstream.status,
          upstream.json,
        )
      : ok({ success: true });
  for (const cookie of upstream.setCookies) {
    response.headers.append("set-cookie", cookie);
  }
  return response;
}
