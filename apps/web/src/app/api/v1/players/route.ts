import { NextRequest, NextResponse } from "next/server";
import { listVisiblePlayers } from "@/lib/public-api/data";
import { withPublicApi } from "@/lib/public-api/middleware";

export async function GET(request: NextRequest) {
  return withPublicApi(request, ["read:players"], async ({ token }) => {
    return NextResponse.json({ players: await listVisiblePlayers(token) });
  });
}
