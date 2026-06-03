import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  filterAndSortPublicCommunityAwards,
  listCommunityAwardRecords,
  readViewerVote,
  toPublicCommunityAward,
} from "@/lib/community-awards";
import { getViewerFamilyContext } from "@/lib/family/member-access";
import { isSupportAdmin } from "@/lib/support/access";

export const runtime = "nodejs";

function parsePositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supportAdmin = isSupportAdmin(session);
  if (!supportAdmin && !session.firebaseIdToken && !session.firebaseRefreshToken) {
    return NextResponse.json({ error: "reauth_required" }, { status: 401 });
  }

  try {
    const checkAccess = async () => {
      if (supportAdmin) {
        return { allowed: true, refreshed: false, refreshedSession: session };
      }
      const result = await runWithRefreshedFirebaseToken(session, async (idToken) => {
        const context = await getViewerFamilyContext(session.uid, session.email, idToken);
        return { allowed: context.viewerRole === "admin" };
      });
      return {
        allowed: result.data.allowed,
        refreshed: result.refreshed,
        refreshedSession: result.session,
      };
    };

    const access = await checkAccess();
    if (!access.allowed) {
      return NextResponse.json({ error: "family_admin_required" }, { status: 403 });
    }

    const url = new URL(request.url);
    const page = parsePositiveInt(url.searchParams.get("page"), 1, 10_000);
    const limit = parsePositiveInt(url.searchParams.get("limit"), 12, 100);
    const search = url.searchParams.get("q") ?? "";
    const sort = url.searchParams.get("sort") ?? "most_popular";
    const records = filterAndSortPublicCommunityAwards(await listCommunityAwardRecords(), { search, sort });
    const start = (page - 1) * limit;
    const pageRecords = records.slice(start, start + limit);
    const awards = await Promise.all(
      pageRecords.map(async (record) => toPublicCommunityAward(record, await readViewerVote(record.id, session.uid))),
    );
    const response = NextResponse.json({
      awards,
      pagination: {
        page,
        limit,
        total: records.length,
        totalPages: Math.max(1, Math.ceil(records.length / limit)),
      },
    });
    if (access.refreshed) {
      setSessionUserCookie(response, access.refreshedSession);
    }
    return response;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.error("[COMMUNITY_AWARDS_GET_ERROR]", reason.slice(0, 240));
    return NextResponse.json({ error: "community_awards_unavailable" }, { status: 500 });
  }
}
