import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  documentIdFromName,
  getDocument,
  listDocuments,
  readBoolean,
  readString,
  readStringArray,
  readTimestamp,
} from "@/lib/firestore/rest";
import { parseCompletionWindow, type CompletionWindow } from "@/lib/preferences/completion-window";
import {
  DEFAULT_MEMBER_PRIMARY_COLOR,
  resolveMemberPrimaryColor,
} from "@/lib/theme/member-primary-color";

type CompletionCount = {
  memberId: string;
  name: string;
  count: number;
  color?: string;
  avatarId?: string;
  avatarPhotoUrl?: string;
};

type CompletionTrendInterval = "hour" | "day" | "week";

type CompletionTrendSeriesMember = {
  memberId: string;
  name: string;
  points: number[];
  color?: string;
};

type CompletionTrendSeries = {
  interval: CompletionTrendInterval;
  labels: string[];
  maxCount: number;
  series: CompletionTrendSeriesMember[];
};

function jsonUnauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

function jsonReauthRequired() {
  return NextResponse.json(
    {
      error: "reauth_required",
      message: "Please sign out and sign in again to refresh your session.",
    },
    { status: 401 },
  );
}

function jsonFirestoreForbidden() {
  return NextResponse.json(
    {
      error: "firestore_forbidden",
      message:
        "Authenticated user does not have access to Firestore documents under current rules.",
    },
    { status: 403 },
  );
}

function parseWindow(value: string | null): CompletionWindow {
  return parseCompletionWindow(value) ?? "today";
}

function dueDateToIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return "";
  }
  return `${value}T00:00:00.000Z`;
}

function toUnixMillis(value: string) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

const DAY_MILLIS = 24 * 60 * 60 * 1000;
const HOUR_MILLIS = 60 * 60 * 1000;
const WEEK_MILLIS = 7 * DAY_MILLIS;
const MINUTE_MILLIS = 60 * 1000;
const MAX_TIMEZONE_OFFSET_MINUTES = 14 * 60;

function startOfUtcDayMillis(value: number) {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

function startOfUtcWeekMillis(value: number) {
  const date = new Date(startOfUtcDayMillis(value));
  const dayOffset = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - dayOffset);
  return date.getTime();
}

function startOfUtcMonthMillis(value: number) {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0);
}

function startOfUtcYearMillis(value: number) {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), 0, 1, 0, 0, 0, 0);
}

function parseTimezoneOffsetMinutes(value: string | null) {
  if (value === null) {
    return 0;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  const rounded = Math.trunc(parsed);
  if (Math.abs(rounded) > MAX_TIMEZONE_OFFSET_MINUTES) {
    return 0;
  }
  return rounded;
}

function toShiftedUtcMillis(value: number, timezoneOffsetMinutes: number) {
  return value - timezoneOffsetMinutes * MINUTE_MILLIS;
}

function fromShiftedUtcMillis(value: number, timezoneOffsetMinutes: number) {
  return value + timezoneOffsetMinutes * MINUTE_MILLIS;
}

function startOfOffsetDayMillis(value: number, timezoneOffsetMinutes: number) {
  return fromShiftedUtcMillis(
    startOfUtcDayMillis(toShiftedUtcMillis(value, timezoneOffsetMinutes)),
    timezoneOffsetMinutes,
  );
}

function startOfOffsetWeekMillis(value: number, timezoneOffsetMinutes: number) {
  return fromShiftedUtcMillis(
    startOfUtcWeekMillis(toShiftedUtcMillis(value, timezoneOffsetMinutes)),
    timezoneOffsetMinutes,
  );
}

function startOfOffsetMonthMillis(value: number, timezoneOffsetMinutes: number) {
  return fromShiftedUtcMillis(
    startOfUtcMonthMillis(toShiftedUtcMillis(value, timezoneOffsetMinutes)),
    timezoneOffsetMinutes,
  );
}

function startOfOffsetYearMillis(value: number, timezoneOffsetMinutes: number) {
  return fromShiftedUtcMillis(
    startOfUtcYearMillis(toShiftedUtcMillis(value, timezoneOffsetMinutes)),
    timezoneOffsetMinutes,
  );
}

type CompletionWindowRange = {
  startMillis: number;
  endMillis: number;
  interval: CompletionTrendInterval;
};

function intervalMillis(interval: CompletionTrendInterval) {
  if (interval === "hour") {
    return HOUR_MILLIS;
  }
  if (interval === "day") {
    return DAY_MILLIS;
  }
  return WEEK_MILLIS;
}

function getWindowRange(
  window: CompletionWindow,
  timezoneOffsetMinutes: number,
): CompletionWindowRange {
  const nowMillis = Date.now();
  if (window === "today") {
    return {
      startMillis: startOfOffsetDayMillis(nowMillis, timezoneOffsetMinutes),
      endMillis: nowMillis,
      interval: "hour",
    };
  }
  if (window === "week") {
    return {
      startMillis: startOfOffsetWeekMillis(nowMillis, timezoneOffsetMinutes),
      endMillis: nowMillis,
      interval: "day",
    };
  }
  if (window === "month") {
    return {
      startMillis: startOfOffsetMonthMillis(nowMillis, timezoneOffsetMinutes),
      endMillis: nowMillis,
      interval: "day",
    };
  }
  return {
    startMillis: startOfOffsetYearMillis(nowMillis, timezoneOffsetMinutes),
    endMillis: nowMillis,
    interval: "week",
  };
}

function buildWindowBucketLabels(
  startMillis: number,
  endMillis: number,
  interval: CompletionTrendInterval,
) {
  const stepMillis = intervalMillis(interval);
  const labels: string[] = [];
  const bucketCount = Math.max(1, Math.floor((endMillis - startMillis) / stepMillis) + 1);
  for (let index = 0; index < bucketCount; index += 1) {
    labels.push(new Date(startMillis + index * stepMillis).toISOString());
  }
  return labels;
}

function emptyTrend(interval: CompletionTrendInterval): CompletionTrendSeries {
  return {
    interval,
    labels: [],
    maxCount: 0,
    series: [],
  };
}

async function getPrimaryFamilyId(uid: string, idToken: string) {
  const userDoc = await getDocument(`users/${uid}`, idToken);
  return readStringArray(userDoc.fields, "familyIds")[0] ?? "";
}

function mapCommonFirestoreErrors(reason: string) {
  if (reason.includes("FIRESTORE_HTTP_401") || reason.includes("FIREBASE_REFRESH_FAILED")) {
    return jsonReauthRequired();
  }
  if (reason.includes("FIRESTORE_HTTP_403")) {
    return jsonFirestoreForbidden();
  }
  return null;
}

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  const window = parseWindow(request.nextUrl.searchParams.get("window"));
  const timezoneOffsetMinutes = parseTimezoneOffsetMinutes(
    request.nextUrl.searchParams.get("tzOffsetMinutes"),
  );

  try {
    const { data, session: refreshedSession, refreshed } =
      await runWithRefreshedFirebaseToken(session, async (idToken) => {
        const { startMillis, endMillis, interval } = getWindowRange(
          window,
          timezoneOffsetMinutes,
        );
        let familyId = "";
        try {
          familyId = await getPrimaryFamilyId(session.uid, idToken);
        } catch (error) {
          const reason = error instanceof Error ? error.message : "";
          if (
            reason.includes("FIRESTORE_HTTP_404") &&
            reason.toLowerCase().includes("document") &&
            reason.toLowerCase().includes("not found")
          ) {
            return {
              window,
              counts: [] as CompletionCount[],
              trend: emptyTrend(interval),
            };
          }
          throw error;
        }
        if (!familyId) {
          return {
            window,
            counts: [] as CompletionCount[],
            trend: emptyTrend(interval),
          };
        }

        const [memberDocs, choreDocs] = await Promise.all([
          listDocuments(`families/${familyId}/members`, idToken, 100),
          listDocuments(`families/${familyId}/chores`, idToken, 500),
        ]);

        const rawMembers = memberDocs
          .map((doc) => ({
            id: documentIdFromName(doc.name),
            uid: readString(doc.fields, "uid") || undefined,
            email: readString(doc.fields, "email"),
            name: readString(doc.fields, "name") || "Unnamed member",
            dashboardPrimaryColor: readString(doc.fields, "dashboardPrimaryColor") || undefined,
            avatarId: readString(doc.fields, "avatarId") || undefined,
            avatarPhotoUrl: readString(doc.fields, "avatarPhotoUrl") || undefined,
            deleted: readBoolean(doc.fields, "deleted"),
          }))
          .filter((member) => !member.deleted);

        const colorByEmail = new Map<string, string>();
        for (const member of rawMembers) {
          const normalizedEmail = normalizeEmail(member.email);
          if (!normalizedEmail) {
            continue;
          }
          if (!member.dashboardPrimaryColor) {
            continue;
          }
          const nextColor = resolveMemberPrimaryColor(member.dashboardPrimaryColor);
          const currentColor = colorByEmail.get(normalizedEmail);
          // Prefer uid-linked member docs when both uid + email invite docs exist.
          if (!currentColor || Boolean(member.uid)) {
            colorByEmail.set(normalizedEmail, nextColor);
          }
        }

        const normalizedEmailWithUid = new Set(
          rawMembers
            .filter((member) => Boolean(member.uid))
            .map((member) => normalizeEmail(member.email))
            .filter(Boolean),
        );

        const members = rawMembers
          .filter((member) => {
            if (member.uid) {
              return true;
            }
            const normalizedEmail = normalizeEmail(member.email);
            if (!normalizedEmail) {
              return true;
            }
            return !normalizedEmailWithUid.has(normalizedEmail);
          })
          .map((member) => {
            const normalizedEmail = normalizeEmail(member.email);
            const resolvedColor = member.dashboardPrimaryColor
              ? resolveMemberPrimaryColor(member.dashboardPrimaryColor)
              : normalizedEmail
                ? colorByEmail.get(normalizedEmail) ?? DEFAULT_MEMBER_PRIMARY_COLOR
                : DEFAULT_MEMBER_PRIMARY_COLOR;
            return {
              ...member,
              dashboardPrimaryColor: resolvedColor,
            };
          });

        const labels = buildWindowBucketLabels(startMillis, endMillis, interval);
        const bucketStepMillis = intervalMillis(interval);
        const countsMap = new Map(
          members.map((member): [string, number] => [member.id, 0]),
        );
        const trendPointsByMember = new Map<string, number[]>(
          members.map(
            (member): [string, number[]] => [
              member.id,
              Array.from({ length: labels.length }, () => 0),
            ],
          ),
        );
        const canonicalByEmail = new Map(
          members
            .map((member) => [normalizeEmail(member.email), member.id] as const)
            .filter(([email]) => Boolean(email)),
        );
        const assigneeAliasToMemberId = new Map<string, string>();
        for (const member of members) {
          assigneeAliasToMemberId.set(member.id, member.id);
          if (member.uid) {
            assigneeAliasToMemberId.set(member.uid, member.id);
          }
        }
        for (const member of rawMembers) {
          const normalizedEmail = normalizeEmail(member.email);
          if (!normalizedEmail || assigneeAliasToMemberId.has(member.id)) {
            continue;
          }
          const canonicalId = canonicalByEmail.get(normalizedEmail);
          if (canonicalId) {
            assigneeAliasToMemberId.set(member.id, canonicalId);
          }
        }

        for (const doc of choreDocs) {
          if (readBoolean(doc.fields, "deleted")) {
            continue;
          }
          const status = readString(doc.fields, "status");
          if (status !== "Submitted" && status !== "Approved") {
            continue;
          }
          const assigneeId = readString(doc.fields, "assigneeId");
          const countedMemberId = assigneeId
            ? assigneeAliasToMemberId.get(assigneeId) ?? assigneeId
            : "";
          if (!countedMemberId || !countsMap.has(countedMemberId)) {
            continue;
          }

          const submittedAt = readTimestamp(doc.fields, "submittedAt");
          const updatedAt = readTimestamp(doc.fields, "updatedAt");
          const dueDate = readString(doc.fields, "dueDate");
          const completedAt = submittedAt || updatedAt || dueDateToIso(dueDate);
          const completionMillis = completedAt ? toUnixMillis(completedAt) : 0;
          if (!completedAt || completionMillis === 0) {
            continue;
          }
          if (completionMillis < startMillis || completionMillis > endMillis) {
            continue;
          }

          countsMap.set(countedMemberId, (countsMap.get(countedMemberId) ?? 0) + 1);
          const bucketIndex = Math.floor((completionMillis - startMillis) / bucketStepMillis);
          const points = trendPointsByMember.get(countedMemberId);
          if (!points || bucketIndex < 0 || bucketIndex >= points.length) {
            continue;
          }
          points[bucketIndex] += 1;
        }

        const counts = members
          .map((member) => ({
            memberId: member.id,
            name: member.name,
            count: countsMap.get(member.id) ?? 0,
            color: member.dashboardPrimaryColor,
            avatarId: member.avatarId,
            avatarPhotoUrl: member.avatarPhotoUrl,
          }))
          .sort((a, b) => {
            if (b.count !== a.count) {
              return b.count - a.count;
            }
            return a.name.localeCompare(b.name);
          });

        const trendSeries = counts.map((member) => ({
          memberId: member.memberId,
          name: member.name,
          color: member.color,
          points:
            trendPointsByMember.get(member.memberId) ??
            Array.from({ length: labels.length }, () => 0),
        }));
        const maxCount = trendSeries.reduce((max, member) => {
          const memberMax = member.points.reduce(
            (pointMax, point) => (point > pointMax ? point : pointMax),
            0,
          );
          return memberMax > max ? memberMax : max;
        }, 0);
        const trend: CompletionTrendSeries = {
          interval,
          labels,
          maxCount,
          series: trendSeries,
        };

        return { window, counts, trend };
      });

    const response = NextResponse.json(data);
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[CHORES_COMPLETION_STATS_ERROR]", reason);
    const mapped = mapCommonFirestoreErrors(reason);
    if (mapped) {
      return mapped;
    }
    return NextResponse.json({ error: "completion_stats_unavailable" }, { status: 500 });
  }
}
