import { NextRequest } from "next/server";
import { fail, ok, proxyJsonWithCookies } from "@/app/api/v1/_lib/response";

// Mobile proxy for "Switch To..." — switch the current session into a child
// profile. Forwards the rotated session cookie back to the mobile client.
export async function POST(request: NextRequest) {
  const upstream = await proxyJsonWithCookies(request, "/api/account-switch/start");
  const response =
    upstream.status >= 400
      ? fail(
          String(upstream.json?.error ?? "switch_account_failed"),
          "Failed to switch account",
          upstream.status,
          upstream.json,
        )
      : ok({ success: true });
  for (const cookie of upstream.setCookies) {
    response.headers.append("set-cookie", cookie);
  }
  return response;
}
