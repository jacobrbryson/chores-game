import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import { jsonReauthRequired, jsonUnauthorized } from "@/lib/family/access";
import { buildDiscoveryViewerContext } from "@/lib/discovery/request-context";
import { markManyDiscoverySectionsSeen } from "@/lib/discovery/service";
import { normalizeDiscoverySection } from "@/lib/discovery/sections";
import { canViewerMarkSectionSeen } from "@/lib/discovery/visibility";
import type { DiscoverySectionKey } from "@/lib/discovery/types";

// POST /api/discovery/seen
// Body: { "sections": ["store", "store:customize_avatar"] }
// Marks one or more discovery sections as seen for the caller's active profile.
// Unknown sections return a validation error; sections the viewer's role cannot
// see (e.g. admin-only) return 403.
export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const rawSections =
    body && typeof body === "object" && Array.isArray((body as { sections?: unknown }).sections)
      ? ((body as { sections: unknown[] }).sections)
      : null;
  if (!rawSections || rawSections.length === 0) {
    return NextResponse.json(
      { error: "invalid_sections", message: "Provide a non-empty sections array." },
      { status: 400 },
    );
  }

  const normalized: DiscoverySectionKey[] = [];
  const unknown: string[] = [];
  for (const entry of rawSections) {
    if (typeof entry !== "string") {
      unknown.push(String(entry));
      continue;
    }
    const section = normalizeDiscoverySection(entry);
    if (section === null) {
      unknown.push(entry);
      continue;
    }
    normalized.push(section);
  }

  if (unknown.length > 0) {
    return NextResponse.json(
      { error: "unknown_section", message: "Unknown discovery section(s).", sections: unknown },
      { status: 400 },
    );
  }

  // Role gate is enforced below against the resolved family role (session.role
  // can lag behind switched/managed-profile state).
  try {
    const { data, session: refreshedSession, refreshed } = await runWithRefreshedFirebaseToken(
      session,
      async (idToken) => {
        const context = await buildDiscoveryViewerContext(session, idToken);
        const denied = normalized.filter(
          (section) => !canViewerMarkSectionSeen(section, context.viewerRole),
        );
        if (denied.length > 0) {
          return { forbidden: denied };
        }
        const deduped = Array.from(new Set(normalized));
        await markManyDiscoverySectionsSeen(context, deduped);
        return { marked: deduped };
      },
    );

    if ("forbidden" in data) {
      return NextResponse.json(
        { error: "forbidden_section", sections: data.forbidden },
        { status: 403 },
      );
    }

    const response = NextResponse.json({ ok: true, marked: data.marked });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    if (reason.includes("FIRESTORE_HTTP_401") || reason.includes("FIREBASE_REFRESH_FAILED")) {
      return jsonReauthRequired();
    }
    if (reason.includes("DISCOVERY_SECTION_FORBIDDEN")) {
      return NextResponse.json({ error: "forbidden_section" }, { status: 403 });
    }
    // Mark-seen should not block navigation; report a soft error.
    console.error("[DISCOVERY_SEEN_POST_ERROR]", reason);
    return NextResponse.json({ error: "discovery_seen_failed" }, { status: 500 });
  }
}
