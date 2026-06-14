import { NextRequest } from "next/server";
import { fail, ok, proxyJsonWithCookies } from "@/app/api/v1/_lib/response";

// Mobile proxy for "Return to Parent" — restore the original signed-in account.
// Forwards the rotated session cookie back to the mobile client.
export async function POST(request: NextRequest) {
  const upstream = await proxyJsonWithCookies(request, "/api/account-switch/stop");
  const response =
    upstream.status >= 400
      ? fail(
          String(upstream.json?.error ?? "restore_account_failed"),
          "Failed to return to parent account",
          upstream.status,
          upstream.json,
        )
      : ok({ success: true });
  for (const cookie of upstream.setCookies) {
    response.headers.append("set-cookie", cookie);
  }
  return response;
}
