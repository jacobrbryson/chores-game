import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { isSupportAdmin } from "@/lib/support/access";
import { adminCreateOrReplaceDocument, adminGetDocument } from "@/lib/firestore/admin";
import { integerField, stringField, timestampField } from "@/lib/firestore/rest";
import {
  RESPONSIBILITY_CONFIG_DOC_PATH,
  defaultResponsibilityConfig,
  invalidateResponsibilityConfigCache,
  parseResponsibilityConfigFields,
} from "@/lib/responsibility/config";

export const runtime = "nodejs";

// Read/update the platform-wide Responsibility XP configuration (XP values
// and level thresholds). Support admins only.
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isSupportAdmin(session)) {
    return NextResponse.json({ error: "support_admin_required" }, { status: 403 });
  }

  try {
    const doc = await adminGetDocument(RESPONSIBILITY_CONFIG_DOC_PATH);
    return NextResponse.json({ config: parseResponsibilityConfigFields(doc.fields) });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("404")) {
      return NextResponse.json({ config: defaultResponsibilityConfig() });
    }
    console.error("[RESPONSIBILITY_CONFIG_GET_ERROR]", reason.slice(0, 180));
    return NextResponse.json({ error: "config_unavailable" }, { status: 500 });
  }
}

type UpdateConfigBody = {
  choreCompletionXp?: unknown;
  routineStepXp?: unknown;
  routineCompletionBonusXp?: unknown;
  newSkillBonusXp?: unknown;
  levelThresholds?: unknown;
};

function parseXp(value: unknown, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return Math.trunc(value);
}

export async function PUT(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isSupportAdmin(session)) {
    return NextResponse.json({ error: "support_admin_required" }, { status: 403 });
  }

  let body: UpdateConfigBody;
  try {
    body = (await request.json()) as UpdateConfigBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const defaults = defaultResponsibilityConfig();
  const thresholds = Array.isArray(body.levelThresholds)
    ? body.levelThresholds.filter(
        (value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0,
      )
    : defaults.levelThresholds;
  const validThresholds =
    thresholds.length >= 2 &&
    thresholds[0] === 0 &&
    thresholds.every((value, index) => index === 0 || value > thresholds[index - 1]);
  if (!validThresholds) {
    return NextResponse.json({ error: "invalid_level_thresholds" }, { status: 400 });
  }

  try {
    await adminCreateOrReplaceDocument(RESPONSIBILITY_CONFIG_DOC_PATH, {
      choreCompletionXp: integerField(
        parseXp(body.choreCompletionXp, defaults.xpValues.choreCompletionXp),
      ),
      routineStepXp: integerField(parseXp(body.routineStepXp, defaults.xpValues.routineStepXp)),
      routineCompletionBonusXp: integerField(
        parseXp(body.routineCompletionBonusXp, defaults.xpValues.routineCompletionBonusXp),
      ),
      newSkillBonusXp: integerField(
        parseXp(body.newSkillBonusXp, defaults.xpValues.newSkillBonusXp),
      ),
      levelThresholdsJson: stringField(JSON.stringify(thresholds.map((v) => Math.trunc(v)))),
      updatedAt: timestampField(new Date().toISOString()),
      updatedBy: stringField(session.uid),
    });
    invalidateResponsibilityConfigCache();
    const doc = await adminGetDocument(RESPONSIBILITY_CONFIG_DOC_PATH);
    return NextResponse.json({ success: true, config: parseResponsibilityConfigFields(doc.fields) });
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 180) : "unknown";
    console.error("[RESPONSIBILITY_CONFIG_PUT_ERROR]", reason);
    return NextResponse.json({ error: "config_update_failed" }, { status: 500 });
  }
}
