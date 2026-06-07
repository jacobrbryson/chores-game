import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { isSupportAdmin } from "@/lib/support/access";

export const runtime = "nodejs";

function resolveWsUrl() {
  return (process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:3001").trim().replace(/\/+$/, "");
}

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isSupportAdmin(session)) {
    return NextResponse.json({ error: "support_admin_required" }, { status: 403 });
  }

  const wsUrl = resolveWsUrl();
  const isProduction = process.env.NODE_ENV === "production";
  const secret = (process.env.WS_INTERNAL_SECRET ?? (isProduction ? "" : "dev-ws-internal-secret")).trim();
  if (!wsUrl || !secret) {
    return NextResponse.json({ activeUsers: 0, connectedClients: 0, unavailable: true });
  }

  try {
    const response = await fetch(`${wsUrl}/metrics`, {
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => ({}))) as {
      activeUsers?: number;
      connectedClients?: number;
      error?: string;
    };
    if (!response.ok) {
      throw new Error(payload.error ?? `WS_METRICS_HTTP_${response.status}`);
    }

    return NextResponse.json({
      activeUsers: Number.isFinite(payload.activeUsers) ? payload.activeUsers : 0,
      connectedClients: Number.isFinite(payload.connectedClients) ? payload.connectedClients : 0,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.error("[SUPPORT_WS_METRICS_ERROR]", reason.slice(0, 180));
    return NextResponse.json({ activeUsers: 0, connectedClients: 0, unavailable: true });
  }
}
