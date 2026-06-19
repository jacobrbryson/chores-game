import { NextResponse } from "next/server";

// Shared HTTP error responses for the chores API routes. These were previously
// duplicated across the chores list/create route and the single-chore route.

export function jsonUnauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export function jsonReauthRequired() {
  return NextResponse.json(
    {
      error: "reauth_required",
      message: "Please sign out and sign in again to refresh your session.",
    },
    { status: 401 },
  );
}

export function jsonFirestoreForbidden() {
  return NextResponse.json(
    {
      error: "firestore_forbidden",
      message:
        "Authenticated user does not have access to Firestore documents under current rules.",
    },
    { status: 403 },
  );
}

// Maps common Firestore REST failures to HTTP responses.
//
// Called without `fallbackError` (list/reorder route): returns a response only
// for auth/permission errors, otherwise `null` so the caller can decide.
// Called with `fallbackError` (single-chore route): always returns a response,
// adding the chore-not-found mapping and a 500 fallback.
export function mapCommonFirestoreErrors(reason: string): NextResponse | null;
export function mapCommonFirestoreErrors(reason: string, fallbackError: string): NextResponse;
export function mapCommonFirestoreErrors(
  reason: string,
  fallbackError?: string,
): NextResponse | null {
  if (reason.includes("FIRESTORE_HTTP_401") || reason.includes("FIREBASE_REFRESH_FAILED")) {
    return jsonReauthRequired();
  }
  if (reason.includes("FIRESTORE_HTTP_403")) {
    return jsonFirestoreForbidden();
  }
  if (fallbackError === undefined) {
    return null;
  }
  if (
    reason.includes("FIRESTORE_HTTP_404") &&
    reason.toLowerCase().includes("document") &&
    reason.toLowerCase().includes("not found")
  ) {
    return NextResponse.json({ error: "chore_not_found" }, { status: 404 });
  }
  return NextResponse.json({ error: fallbackError }, { status: 500 });
}
