import { NextResponse } from "next/server";
import { getCanonicalAppOrigin } from "@/lib/app-origin";

export async function GET() {
  // `request.nextUrl.origin` resolves to the Cloud Run container's internal
  // bind address in production, so the redirect must use the canonical origin.
  return NextResponse.redirect(new URL("/docs/api", getCanonicalAppOrigin()));
}
