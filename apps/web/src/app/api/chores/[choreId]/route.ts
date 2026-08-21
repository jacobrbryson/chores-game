import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import { getDocument, readBoolean } from "@/lib/firestore/rest";
import {
  normalizeRecurrenceConfig,
  parseCoinValue,
  parseRequireApproval,
} from "@/lib/chores/recurrence";
import { normalizeResponsibilityPillar } from "@/lib/responsibility/types";
import {
  buildCategoryMap,
  listFamilyCategories,
  normalizeCategoryIds,
} from "@/lib/family/categories";
import {
  jsonReauthRequired,
  jsonUnauthorized,
  mapCommonFirestoreErrors,
} from "@/lib/chores/http-responses";
import { getPrimaryFamilyId, getRequesterContext } from "@/lib/chores/access";
import {
  asValidDate,
  normalizeAssigneeIds,
  normalizeDescription,
  parseOptionalNewSkillEnabled,
} from "@/lib/chores/input";
import { syncGoogleTasksBestEffort } from "@/lib/chores/activity-helpers";
import { formatServerTiming } from "@/lib/observability/request-context";
import { runAfterResponse } from "@/lib/async/after-response";
import { buildChoreDetailPayload } from "@/lib/chores/chore-serializer";
import {
  MAX_ACTIVE_CHORES_PER_ASSIGNEE,
  type ChoreActionContext,
  type ChoreActionOutcome,
  type UpdateChoreBody,
} from "./actions/context";
import { handleComplete } from "./actions/complete";
import { handleUndoComplete } from "./actions/undo-complete";
import { handleSkip, handleUnskip } from "./actions/skip-unskip";
import { handleApprove } from "./actions/approve";
import { handleReject } from "./actions/reject";
import { handleEdit, handleSetCategories } from "./actions/edit";
import { handleDelete } from "./actions/delete";

type ChoreAction =
  | "edit"
  | "complete"
  | "undo_complete"
  | "skip"
  | "unskip"
  | "set_categories"
  | "approve"
  | "reject";

const CHORE_ACTIONS: ReadonlySet<ChoreAction> = new Set([
  "edit",
  "complete",
  "undo_complete",
  "skip",
  "unskip",
  "set_categories",
  "approve",
  "reject",
]);

function dispatchChoreAction(
  action: ChoreAction,
  ctx: ChoreActionContext,
): Promise<ChoreActionOutcome> {
  switch (action) {
    case "complete":
      return handleComplete(ctx);
    case "undo_complete":
      return handleUndoComplete(ctx);
    case "skip":
      return handleSkip(ctx);
    case "unskip":
      return handleUnskip(ctx);
    case "approve":
      return handleApprove(ctx);
    case "reject":
      return handleReject(ctx);
    case "set_categories":
      return handleSetCategories(ctx);
    case "edit":
      return handleEdit(ctx);
  }
}

// Maps a non-ok action outcome to its HTTP response. Returns null for "ok".
function mapActionError(outcome: ChoreActionOutcome): NextResponse | null {
  switch (outcome.kind) {
    case "ok":
      return null;
    case "chore_not_found":
      return NextResponse.json({ error: "chore_not_found" }, { status: 404 });
    case "forbidden_action":
      return NextResponse.json({ error: "forbidden_action" }, { status: 403 });
    case "invalid_transition":
      return NextResponse.json({ error: "invalid_status_transition" }, { status: 400 });
    case "wallet_negative_blocked":
      return NextResponse.json(
        { error: "wallet_negative_blocked", message: "Cannot undo completion after coins were spent." },
        { status: 409 },
      );
    case "wallet_permission_denied":
      return NextResponse.json(
        {
          error: "wallet_permission_denied",
          message: "Missing permission to update wallet ledger for this chore transition.",
        },
        { status: 403 },
      );
    case "recurring_successor_locked":
      return NextResponse.json(
        {
          error: "recurring_successor_locked",
          message: "Cannot undo this completed recurring chore because the next occurrence already changed.",
        },
        { status: 409 },
      );
    case "active_chore_limit_reached":
      return NextResponse.json(
        { error: "active_chore_limit_reached", maxActiveChores: MAX_ACTIVE_CHORES_PER_ASSIGNEE },
        { status: 409 },
      );
    case "invalid_category_ids":
      return NextResponse.json({ error: "invalid_category_ids" }, { status: 400 });
    case "not_routine_step":
      return NextResponse.json({ error: "not_routine_step" }, { status: 400 });
    case "routine_step_single_assignee_only":
      return NextResponse.json({ error: "routine_step_single_assignee_only" }, { status: 400 });
  }
}

export async function GET(request: NextRequest, context: { params: Promise<{ choreId: string }> }) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  const { choreId } = await context.params;
  if (!choreId) {
    return NextResponse.json({ error: "chore_id_required" }, { status: 400 });
  }

  try {
    const { data, session: refreshedSession, refreshed, timing } = await runWithRefreshedFirebaseToken(
      session,
      async (idToken) => {
        const familyId = await getPrimaryFamilyId(session.uid, idToken);
        if (!familyId) {
          return { kind: "family_not_found" as const };
        }
        const requester = await getRequesterContext(familyId, session.uid, session.email, idToken);
        const choreDoc = await getDocument(`families/${familyId}/chores/${choreId}`, idToken);
        if (readBoolean(choreDoc.fields, "deleted")) {
          return { kind: "chore_not_found" as const };
        }
        const categoryMap = buildCategoryMap(await listFamilyCategories(familyId, idToken));
        const chore = await buildChoreDetailPayload({
          choreId,
          fields: choreDoc.fields,
          categoryMap,
          familyId,
          idToken,
        });
        return { kind: "ok" as const, chore, viewerRole: requester.role };
      },
    );

    if (data.kind === "family_not_found") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    if (data.kind === "chore_not_found") {
      return NextResponse.json({ error: "chore_not_found" }, { status: 404 });
    }

    const response = NextResponse.json({ chore: data.chore, viewerRole: data.viewerRole });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    response.headers.set("Server-Timing", formatServerTiming(timing));
    return response;
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[CHORE_GET_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "chore_unavailable");
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ choreId: string }> },
) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  const { choreId } = await context.params;
  if (!choreId) {
    return NextResponse.json({ error: "chore_id_required" }, { status: 400 });
  }

  let body: UpdateChoreBody;
  try {
    body = (await request.json()) as UpdateChoreBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const action = (typeof body.action === "string" ? body.action : "edit") as ChoreAction;
  if (!CHORE_ACTIONS.has(action)) {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }

  const normalizedDescription =
    typeof body.description === "string" ? normalizeDescription(body.description) : "";
  const assigneeId =
    typeof body.assigneeId === "string" && body.assigneeId.trim().length > 0
      ? body.assigneeId.trim()
      : "";
  const assigneeIds = normalizeAssigneeIds(body.assigneeIds);
  const assigneeScope =
    body.assigneeScope === "family" ||
    body.assigneeScope === "multiple" ||
    body.assigneeScope === "single"
      ? body.assigneeScope
      : "";
  const dueDate = asValidDate(body.dueDate);
  const details =
    typeof body.details === "string" && body.details.trim().length > 0
      ? body.details.trim().slice(0, 2000)
      : "";
  const coinValue = parseCoinValue(body.coinValue);
  const requireApproval = parseRequireApproval(body.requireApproval);
  const newSkillEnabled = parseOptionalNewSkillEnabled(body.newSkillEnabled);
  const recurrence = normalizeRecurrenceConfig({
    recurrenceType: body.recurrenceType,
    recurrenceInterval: body.recurrenceInterval,
    recurrenceUnit: body.recurrenceUnit,
    recurrenceDays: body.recurrenceDays,
  });
  const feedback =
    typeof body.feedback === "string" && body.feedback.trim().length > 0
      ? body.feedback.trim().slice(0, 500)
      : "";
  const hasCategoryIds = Array.isArray(body.categoryIds);
  const categoryIds = normalizeCategoryIds(body.categoryIds);
  const hasResponsibilityPillar = body.responsibilityPillar !== undefined;
  const responsibilityPillar = normalizeResponsibilityPillar(body.responsibilityPillar);
  const resolvedAssigneeIds = assigneeIds.length > 0 ? assigneeIds : assigneeId ? [assigneeId] : [];
  const resolvedAssigneeScope =
    assigneeScope ||
    (resolvedAssigneeIds.length > 1 ? "multiple" : resolvedAssigneeIds.length === 1 ? "single" : "single");
  const resolvedSingleAssigneeId =
    resolvedAssigneeScope === "single" && resolvedAssigneeIds.length === 1 ? resolvedAssigneeIds[0] : "";

  if (action === "set_categories" && !hasCategoryIds) {
    return NextResponse.json({ error: "category_ids_required" }, { status: 400 });
  }

  if (action === "edit") {
    if (!normalizedDescription) {
      return NextResponse.json({ error: "description_required" }, { status: 400 });
    }
    if (normalizedDescription.length > 160) {
      return NextResponse.json({ error: "description_too_long" }, { status: 400 });
    }
    if (!dueDate) {
      return NextResponse.json({ error: "due_date_required" }, { status: 400 });
    }
    if (coinValue === null) {
      return NextResponse.json({ error: "invalid_coin_value" }, { status: 400 });
    }
  }

  try {
    const { data, session: refreshedSession, refreshed, timing } = await runWithRefreshedFirebaseToken(
      session,
      async (idToken) => {
        const familyId = await getPrimaryFamilyId(session.uid, idToken);
        if (!familyId) {
          return { kind: "family_not_found" as const };
        }
        const ctx: ChoreActionContext = {
          familyId,
          idToken,
          session,
          choreId,
          now: new Date().toISOString(),
          actorName: session.name || session.email,
          body,
          normalizedDescription,
          dueDate,
          details,
          coinValue,
          requireApproval,
          newSkillEnabled,
          recurrence,
          feedback,
          hasCategoryIds,
          categoryIds,
          hasResponsibilityPillar,
          responsibilityPillar,
          resolvedAssigneeIds,
          resolvedAssigneeScope,
          resolvedSingleAssigneeId,
        };
        const outcome = await dispatchChoreAction(action, ctx);
        if (outcome.kind === "ok" && outcome.syncOwnerUid) {
          // Pushes the status change back to Google Tasks. `force` is kept — this
          // sync exists precisely to mirror the transition upstream, so the rate
          // limiter must not skip it — but it is an external API call on the
          // hottest mutation in the app, so it no longer blocks the response.
          await runAfterResponse("chore-action:google-tasks-sync", () =>
            syncGoogleTasksBestEffort({
              uid: outcome.syncOwnerUid,
              idToken,
              force: true,
              minIntervalSeconds: 0,
            }),
          );
        }
        return outcome;
      },
    );

    if (data.kind === "family_not_found") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    const errorResponse = mapActionError(data);
    if (errorResponse) {
      return errorResponse;
    }

    const bonus = data.kind === "ok" ? data.newSkillBonus : undefined;
    const xp = data.kind === "ok" ? data.responsibilityXp : undefined;
    const routineProgressPayload =
      data.kind === "ok" && data.routineProgress
        ? { routineProgress: data.routineProgress }
        : undefined;
    const responsibilityXpPayload =
      xp && xp.pillar && (xp.choreXpAwarded > 0 || xp.newSkillXpAwarded > 0)
        ? {
            responsibilityXp: {
              pillar: xp.pillar,
              choreXpAwarded: xp.choreXpAwarded,
              newSkillXpAwarded: xp.newSkillXpAwarded,
              ...(xp.title ? { title: xp.title } : {}),
            },
          }
        : undefined;
    const response = NextResponse.json(
      bonus && bonus.awarded
        ? {
            success: true,
            newSkillBonus: {
              awarded: true,
              amount: bonus.amount,
              totalCoins: bonus.totalCoins,
              playerUids: bonus.playerUids,
            },
            ...responsibilityXpPayload,
            ...routineProgressPayload,
          }
        : { success: true, ...responsibilityXpPayload, ...routineProgressPayload },
    );
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    response.headers.set("Server-Timing", formatServerTiming(timing));
    return response;
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[CHORE_PATCH_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "update_chore_failed");
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ choreId: string }> },
) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  const { choreId } = await context.params;
  if (!choreId) {
    return NextResponse.json({ error: "chore_id_required" }, { status: 400 });
  }

  try {
    const { data, session: refreshedSession, refreshed, timing } = await runWithRefreshedFirebaseToken(
      session,
      async (idToken) => {
        const familyId = await getPrimaryFamilyId(session.uid, idToken);
        if (!familyId) {
          return { kind: "family_not_found" as const };
        }
        return handleDelete({ familyId, idToken, session, choreId });
      },
    );

    if (data.kind === "family_not_found") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    if (data.kind === "forbidden_action") {
      return NextResponse.json({ error: "forbidden_action" }, { status: 403 });
    }
    if (data.kind === "wallet_negative_blocked") {
      return NextResponse.json(
        { error: "wallet_negative_blocked", message: "Cannot delete completed chore after coins were spent." },
        { status: 409 },
      );
    }
    if (data.kind === "wallet_permission_denied") {
      return NextResponse.json(
        {
          error: "wallet_permission_denied",
          message: "Missing permission to update wallet ledger for this chore transition.",
        },
        { status: 403 },
      );
    }

    const response = NextResponse.json({ success: true });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    response.headers.set("Server-Timing", formatServerTiming(timing));
    return response;
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[CHORE_SOFT_DELETE_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "delete_chore_failed");
  }
}
