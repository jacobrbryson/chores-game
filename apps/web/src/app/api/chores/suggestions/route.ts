import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  getDocument,
  listAllDocuments,
  readBoolean,
  readInteger,
  readString,
  readStringArray,
} from "@/lib/firestore/rest";

type Suggestion = {
  description: string;
  familyCount: number;
};

const MAX_SUGGESTIONS = 100;

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

function normalizeQuery(value: string) {
  return value.trim().toLowerCase();
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function getPrimaryFamilyId(uid: string, idToken: string) {
  const userDoc = await getDocument(`users/${uid}`, idToken);
  return readStringArray(userDoc.fields, "familyIds")[0] ?? "";
}

function upsertSuggestion(map: Map<string, Suggestion>, next: Suggestion) {
  const key = next.description.toLowerCase();
  const existing = map.get(key);
  if (!existing) {
    map.set(key, next);
    return;
  }
  map.set(key, {
    description: existing.description,
    familyCount: Math.max(existing.familyCount, next.familyCount),
  });
}

function matchesQuery(description: string, query: string) {
  if (!query) {
    return true;
  }
  const normalized = description.toLowerCase();
  return normalized.startsWith(query) || normalized.includes(query);
}

function rankSuggestions(entries: Suggestion[]) {
  return entries
    .sort((a, b) => {
      if (b.familyCount !== a.familyCount) {
        return b.familyCount - a.familyCount;
      }
      return a.description.localeCompare(b.description);
    })
    .slice(0, MAX_SUGGESTIONS);
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

function isForbiddenOrMissing(reason: string) {
  return (
    reason.includes("FIRESTORE_HTTP_403") ||
    (reason.includes("FIRESTORE_HTTP_404") &&
      reason.toLowerCase().includes("document") &&
      reason.toLowerCase().includes("not found"))
  );
}

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  const query = normalizeQuery(request.nextUrl.searchParams.get("q") ?? "");
  const useQuery = query.length >= 3 ? query : "";
  const assigneeId = (request.nextUrl.searchParams.get("assigneeId") ?? "").trim();
  const dueDateRaw = (request.nextUrl.searchParams.get("dueDate") ?? "").trim();
  const dueDate = isIsoDate(dueDateRaw) ? dueDateRaw : new Date().toISOString().slice(0, 10);
  const excludeChoreId = (request.nextUrl.searchParams.get("excludeChoreId") ?? "").trim();

  try {
    const { data, session: refreshedSession, refreshed } =
      await runWithRefreshedFirebaseToken(session, async (idToken) => {
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
            return { suggestions: [] as Suggestion[] };
          }
          throw error;
        }

        const familyUsageDocs = await (async () => {
          if (!familyId) {
            return [];
          }
          try {
            return await listAllDocuments(`families/${familyId}/choreUsage`, idToken, { cap: 500 });
          } catch (error) {
            const reason = error instanceof Error ? error.message : "";
            if (isForbiddenOrMissing(reason)) {
              return [];
            }
            throw error;
          }
        })();

        const familyChoreDocs = familyId
          ? await (async () => {
              try {
                return await listAllDocuments(`families/${familyId}/chores`, idToken, { cap: 500 });
              } catch (error) {
                const reason = error instanceof Error ? error.message : "";
                if (isForbiddenOrMissing(reason)) {
                  return [];
                }
                throw error;
              }
            })()
          : [];

        const suggestionsMap = new Map<string, Suggestion>();
        const excludedDescriptions = new Set<string>();

        if (assigneeId) {
          for (const doc of familyChoreDocs) {
            const title = readString(doc.fields, "title");
            if (!title) {
              continue;
            }
            if (readBoolean(doc.fields, "deleted")) {
              continue;
            }
            const choreId = doc.name.split("/").pop() ?? "";
            if (excludeChoreId && choreId === excludeChoreId) {
              continue;
            }
            const choreAssigneeId = readString(doc.fields, "assigneeId");
            const choreDueDate = readString(doc.fields, "dueDate");
            if (choreAssigneeId !== assigneeId || choreDueDate !== dueDate) {
              continue;
            }
            excludedDescriptions.add(title.toLowerCase());
          }
        }

        for (const doc of familyUsageDocs) {
          const description = readString(doc.fields, "description");
          if (!description || !matchesQuery(description, useQuery)) {
            continue;
          }
          upsertSuggestion(suggestionsMap, {
            description,
            familyCount: readInteger(doc.fields, "familyCount"),
          });
        }

        // Fallback/fill from actual family chore history so autocomplete still works
        // even when usage counters are unavailable or sparse.
        const familyHistoryCounts = new Map<string, number>();
        for (const doc of familyChoreDocs) {
          const description = readString(doc.fields, "title");
          if (!description || !matchesQuery(description, useQuery)) {
            continue;
          }
          if (readBoolean(doc.fields, "deleted")) {
            continue;
          }
          const key = description.toLowerCase();
          familyHistoryCounts.set(key, (familyHistoryCounts.get(key) ?? 0) + 1);
        }
        for (const [key, count] of familyHistoryCounts.entries()) {
          const existing = suggestionsMap.get(key);
          if (existing) {
            upsertSuggestion(suggestionsMap, {
              description: existing.description,
              familyCount: Math.max(existing.familyCount, count),
            });
            continue;
          }
          const title =
            familyChoreDocs
              .map((doc) => readString(doc.fields, "title"))
              .find((value) => value.toLowerCase() === key) ?? key;
          upsertSuggestion(suggestionsMap, {
            description: title,
            familyCount: count,
          });
        }

        return {
          suggestions: rankSuggestions(
            [...suggestionsMap.values()].filter(
              (entry) => !excludedDescriptions.has(entry.description.toLowerCase()),
            ),
          ),
        };
      });

    const response = NextResponse.json(data);
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[CHORE_SUGGESTIONS_ERROR]", reason);
    const mapped = mapCommonFirestoreErrors(reason);
    if (mapped) {
      return mapped;
    }
    return NextResponse.json({ error: "suggestions_unavailable" }, { status: 500 });
  }
}
