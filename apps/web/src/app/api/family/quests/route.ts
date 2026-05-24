import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import { getViewerFamilyContext } from "@/lib/family/member-access";
import {
  FAMILY_QUEST_LIMIT,
  familyQuestObjectPrefix,
  listFamilyQuests,
  saveFamilyQuest,
  scoreQuest,
} from "@/lib/quests/family-quests";
import { uploadGcsObject } from "@/lib/gcs/storage";
import { validateQuestDefinition } from "@/lib/quests/validation";
import type { QuestDefinition } from "@/lib/quests/types";

function jsonUnauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

function jsonReauthRequired() {
  return NextResponse.json({ error: "reauth_required" }, { status: 401 });
}

function mapCommonErrors(reason: string, fallbackError: string) {
  if (reason.includes("FIRESTORE_HTTP_401") || reason.includes("FIREBASE_REFRESH_FAILED")) {
    return jsonReauthRequired();
  }
  if (reason.includes("FIRESTORE_HTTP_403")) {
    return NextResponse.json({ error: "firestore_forbidden" }, { status: 403 });
  }
  return NextResponse.json({ error: fallbackError }, { status: 500 });
}

function sanitizeFileName(value: string) {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");
  return normalized.slice(0, 96) || "asset";
}

async function applyUploadedAssets(input: {
  formData: FormData;
  familyId: string;
  quest: QuestDefinition;
}) {
  const quest = structuredClone(input.quest) as QuestDefinition;
  const draftPrefix = familyQuestObjectPrefix(input.familyId, "draft", quest.id);
  const nodeById = new Map(quest.nodes.map((node) => [node.id, node]));

  for (const [key, value] of input.formData.entries()) {
    if (!(value instanceof File) || value.size <= 0) {
      continue;
    }
    const buffer = Buffer.from(await value.arrayBuffer());
    const fileName = sanitizeFileName(value.name);
    const objectPath = `${draftPrefix}/assets/${Date.now()}-${fileName}`;
    const upload = await uploadGcsObject(objectPath, buffer, value.type || "application/octet-stream");

    if (key === "coverImage") {
      quest.coverImage = upload.publicUrl;
      continue;
    }
    if (key.startsWith("nodeImage:")) {
      const node = nodeById.get(key.slice("nodeImage:".length));
      if (node) {
        node.image = upload.publicUrl;
      }
      continue;
    }
    if (key.startsWith("nodeAudio:")) {
      const node = nodeById.get(key.slice("nodeAudio:".length));
      if (node) {
        node.audio = upload.publicUrl;
      }
    }
  }

  return validateQuestDefinition(quest);
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
        const context = await getViewerFamilyContext(session.uid, session.email ?? "", idToken);
        if (!context.familyId) {
          return { noFamily: true, quests: [], viewerRole: "player" as const, maxQuests: FAMILY_QUEST_LIMIT };
        }
        return {
          noFamily: false,
          quests: await listFamilyQuests(context.familyId, idToken),
          viewerRole: context.viewerRole,
          maxQuests: FAMILY_QUEST_LIMIT,
        };
      },
    );
    const response = NextResponse.json(data);
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 220) : "unknown";
    console.error("[FAMILY_QUESTS_GET_ERROR]", reason);
    return mapCommonErrors(reason, "family_quests_unavailable");
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

  try {
    const formData = await request.formData();
    const rawQuest = formData.get("quest");
    if (typeof rawQuest !== "string") {
      return NextResponse.json({ error: "quest_required" }, { status: 400 });
    }
    const publish = formData.get("publish") === "true";
    const parsedQuest = validateQuestDefinition(JSON.parse(rawQuest));

    const { data, session: refreshedSession, refreshed } = await runWithRefreshedFirebaseToken(
      session,
      async (idToken) => {
        const context = await getViewerFamilyContext(session.uid, session.email ?? "", idToken);
        if (!context.familyId) {
          return { kind: "no_family" as const };
        }
        if (context.viewerRole !== "admin") {
          return { kind: "forbidden" as const };
        }
        const quests = await listFamilyQuests(context.familyId, idToken);
        const existing = quests.find((quest) => quest.id === parsedQuest.id);
        if (!existing && quests.length >= FAMILY_QUEST_LIMIT) {
          return { kind: "limit_reached" as const };
        }
        const questWithAssets = await applyUploadedAssets({
          formData,
          familyId: context.familyId,
          quest: parsedQuest,
        });
        const saved = await saveFamilyQuest({
          familyId: context.familyId,
          quest: questWithAssets,
          idToken,
          publish,
        });
        return { kind: "ok" as const, ...saved };
      },
    );

    if (data.kind === "no_family") {
      return NextResponse.json({ error: "family_required" }, { status: 400 });
    }
    if (data.kind === "forbidden") {
      return NextResponse.json({ error: "admin_required" }, { status: 403 });
    }
    if (data.kind === "limit_reached") {
      return NextResponse.json({ error: "family_quest_limit_reached" }, { status: 409 });
    }

    const response = NextResponse.json(data);
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 220) : "unknown";
    console.error("[FAMILY_QUESTS_POST_ERROR]", reason);
    if (reason.startsWith("QUEST_") || reason.includes("JSON")) {
      return NextResponse.json({ error: "invalid_quest", detail: reason }, { status: 400 });
    }
    return mapCommonErrors(reason, "family_quest_save_failed");
  }
}

export async function PUT(request: NextRequest) {
  return POST(request);
}

export async function PATCH(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }
  try {
    const body = (await request.json()) as { quest?: unknown };
    const quest = validateQuestDefinition(body.quest);
    const validation = await scoreQuest(quest);
    return NextResponse.json({ score: validation.score, issues: validation.issues });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "invalid_quest";
    return NextResponse.json({ error: "invalid_quest", detail: reason, score: 0, issues: [reason] }, { status: 400 });
  }
}
