import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  getGoogleTasksProfileState,
  setGoogleTasksSelectedTaskLists,
  unlinkGoogleTasks,
} from "@/lib/google/tasks-link";
import { syncGoogleTasksForUser } from "@/lib/google/tasks-sync";

type GoogleTasksActionBody = {
  action?: unknown;
  taskListId?: unknown;
  taskListIds?: unknown;
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

function mapCommonErrors(reason: string, fallbackError: string) {
  if (reason.includes("FIRESTORE_HTTP_401") || reason.includes("FIREBASE_REFRESH_FAILED")) {
    return jsonReauthRequired();
  }
  if (reason.includes("FIRESTORE_HTTP_403")) {
    return jsonFirestoreForbidden();
  }
  return NextResponse.json({ error: fallbackError }, { status: 500 });
}

function defaultGoogleTasksProfileState() {
  return {
    accountLinked: false,
    linked: false,
    lastSyncStatus: "idle" as const,
    selectedTaskListIds: [],
    selectedTaskListTitles: [],
    taskLists: [],
  };
}

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  try {
    const { data, session: refreshedSession, refreshed } = await runWithRefreshedFirebaseToken(
      session,
      async (idToken) => {
        try {
          return await getGoogleTasksProfileState(session.uid, idToken);
        } catch (error) {
          const reason = error instanceof Error ? error.message : "";
          if (reason.includes("FIRESTORE_HTTP_404")) {
            return defaultGoogleTasksProfileState();
          }
          throw error;
        }
      },
    );

    const response = NextResponse.json(data);
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[GOOGLE_TASKS_GET_ERROR]", reason);
    return mapCommonErrors(reason, "google_tasks_unavailable");
  }
}

export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  let body: GoogleTasksActionBody;
  try {
    body = (await request.json()) as GoogleTasksActionBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "";
  if (action !== "sync_now" && action !== "set_task_list" && action !== "unlink") {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }

  try {
    const { data, session: refreshedSession, refreshed } = await runWithRefreshedFirebaseToken(
      session,
      async (idToken) => {
        if (action === "unlink") {
          await unlinkGoogleTasks(session.uid, idToken);
          return {
            success: true,
            linked: false,
          };
        }

        if (action === "set_task_list") {
          const taskListIds = Array.isArray(body.taskListIds)
            ? body.taskListIds
                .filter((entry): entry is string => typeof entry === "string")
                .map((entry) => entry.trim())
                .filter((entry, index, values) => entry.length > 0 && values.indexOf(entry) === index)
            : typeof body.taskListId === "string" && body.taskListId.trim()
              ? [body.taskListId.trim()]
              : [];
          if (taskListIds.length === 0) {
            return { kind: "task_list_required" as const };
          }
          await setGoogleTasksSelectedTaskLists({
            uid: session.uid,
            idToken,
            taskListIds,
          });
        }

        const syncResult = await syncGoogleTasksForUser({
          uid: session.uid,
          idToken,
          force: true,
          minIntervalSeconds: 0,
          throwOnError: true,
        });
        if (syncResult.kind === "skipped" && syncResult.reason === "not_linked") {
          return { kind: "not_linked" as const };
        }
        const summary = await getGoogleTasksProfileState(session.uid, idToken);
        return {
          kind: "ok" as const,
          success: true,
          syncResult,
          summary,
        };
      },
    );

    if ("kind" in data && data.kind === "task_list_required") {
      return NextResponse.json({ error: "task_list_id_required" }, { status: 400 });
    }
    if ("kind" in data && data.kind === "not_linked") {
      return NextResponse.json({ error: "google_tasks_not_linked" }, { status: 409 });
    }

    const response = NextResponse.json(data);
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[GOOGLE_TASKS_POST_ERROR]", reason);
    if (reason.includes("GOOGLE_TASKS_NOT_LINKED")) {
      return NextResponse.json({ error: "google_tasks_not_linked" }, { status: 409 });
    }
    if (reason.includes("GOOGLE_TASK_LIST_NOT_FOUND")) {
      return NextResponse.json({ error: "google_task_list_not_found" }, { status: 404 });
    }
    return mapCommonErrors(reason, "google_tasks_update_failed");
  }
}
