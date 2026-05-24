import { NextRequest, NextResponse } from "next/server";
import { buildPublicApiOpenApiSpec } from "@/lib/public-api/openapi";

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  return NextResponse.json(buildPublicApiOpenApiSpec(origin));
}
