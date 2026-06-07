import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import { jsonReauthRequired, jsonUnauthorized } from "@/lib/family/access";
import { buildDiscoveryViewerContext } from "@/lib/discovery/request-context";
import { getDiscoverySummaryForViewer } from "@/lib/discovery/service";
import { normalizeDiscoverySection } from "@/lib/discovery/sections";
import type { DiscoverySectionKey, DiscoverySummary } from "@/lib/discovery/types";

const EMPTY_SUMMARY: DiscoverySummary = { sections: {}, totalCount: 0 };

// GET /api/discovery/summary
// Returns the active profile's discovery (What's New) summary. Optional
// `?sections=chores,store,quests` narrows the response. Discovery fails soft:
// any computation error returns an empty summary so navigation and badges never
// break the app (auth failures still return 401).
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  const sectionsParam = request.nextUrl.searchParams.get("sections");
  let requestedSections: DiscoverySectionKey[] | undefined;
  if (sectionsParam) {
    const parsed = sectionsParam
      .split(",")
      .map((value) => normalizeDiscoverySection(value))
      .filter((value): value is DiscoverySectionKey => value !== null);
    requestedSections = parsed.length > 0 ? parsed : undefined;
  }

  try {
    const { data, session: refreshedSession, refreshed } = await runWithRefreshedFirebaseToken(
      session,
      async (idToken) => {
        const context = await buildDiscoveryViewerContext(session, idToken);
        return getDiscoverySummaryForViewer(context, { sections: requestedSections });
      },
    );

    const response = NextResponse.json(data);
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    if (reason.includes("FIRESTORE_HTTP_401") || reason.includes("FIREBASE_REFRESH_FAILED")) {
      return jsonReauthRequired();
    }
    // Fail soft: log server-side, return an empty summary so the UI degrades
    // gracefully (no badges) instead of erroring.
    console.error("[DISCOVERY_SUMMARY_GET_ERROR]", reason);
    return NextResponse.json(EMPTY_SUMMARY);
  }
}
