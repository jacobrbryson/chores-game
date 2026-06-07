import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { isSupportAdmin } from "@/lib/support/access";
import { adminPatchDocument } from "@/lib/firestore/admin";
import { stringField } from "@/lib/firestore/rest";

export const runtime = "nodejs";

type ResetMode = "reacceptance" | "full";

function isResetMode(value: unknown): value is ResetMode {
  return value === "reacceptance" || value === "full";
}

export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isSupportAdmin(session)) {
    return NextResponse.json({ error: "support_admin_required" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { familyId, mode } = body as { familyId?: unknown; mode?: unknown };

  if (!familyId || typeof familyId !== "string" || !familyId.trim()) {
    return NextResponse.json({ error: "familyId_required" }, { status: 400 });
  }
  if (!isResetMode(mode)) {
    return NextResponse.json({ error: "mode_must_be_reacceptance_or_full" }, { status: 400 });
  }

  // "reacceptance": clear version strings so the family must re-accept updated
  // policies, but keep parentalConsentAt and onboardingCompletedAt so they skip
  // the full onboarding wizard.
  //
  // "full": clear all consent fields so the family goes through the onboarding
  // wizard from scratch on next sign-in.
  const updateMask =
    mode === "full"
      ? ["acceptedTermsVersion", "acceptedPrivacyVersion", "parentalConsentAt", "onboardingCompletedAt"]
      : ["acceptedTermsVersion", "acceptedPrivacyVersion"];

  try {
    await adminPatchDocument(
      `families/${familyId}`,
      {
        acceptedTermsVersion: stringField(""),
        acceptedPrivacyVersion: stringField(""),
      },
      updateMask,
    );

    console.log(
      `[SUPPORT_RESET_CONSENT] family=${familyId} mode=${mode} by=${session.email ?? session.uid}`,
    );

    return NextResponse.json({ ok: true, mode });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.error("[SUPPORT_RESET_CONSENT_ERROR]", reason.slice(0, 200));
    return NextResponse.json({ error: "reset_consent_failed" }, { status: 500 });
  }
}
