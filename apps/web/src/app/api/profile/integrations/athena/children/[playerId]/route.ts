import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { adminGetDocument } from "@/lib/firestore/admin";
import { readString } from "@/lib/firestore/rest";
import {
  AthenaIntegrationError,
  connectAthenaChild,
  disconnectAthenaChild,
  type AthenaChildSummary,
} from "@/lib/integrations/athena";
import {
  deleteAthenaChildLink,
  getAthenaChildLink,
  getAthenaConnection,
  saveAthenaChildLink,
} from "@/lib/integrations/athena-store";
import { resolveUserFamilyForApiToken } from "@/lib/public-api/tokens";

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

function forbidden() {
  return NextResponse.json(
    { error: "forbidden", message: "Only a parent or admin can manage Athena." },
    { status: 403 },
  );
}

type Ctx = { params: Promise<{ playerId: string }> };

/** Load the family member (child player) doc, or null. */
async function loadMember(familyId: string, playerId: string) {
  try {
    const doc = await adminGetDocument(`families/${familyId}/members/${playerId}`);
    return {
      displayName: readString(doc.fields, "name") || "Child",
      email: readString(doc.fields, "email"),
      role: readString(doc.fields, "role") === "admin" ? "admin" : "player",
    };
  } catch {
    return null;
  }
}

async function requireAdminFamily(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return { error: unauthorized() as NextResponse };
  }
  if (session.role !== "admin") {
    return { error: forbidden() as NextResponse };
  }
  if (!session.email) {
    return {
      error: NextResponse.json(
        { error: "invalid_request", message: "Your account needs an email set first." },
        { status: 400 },
      ) as NextResponse,
    };
  }
  const context = await resolveUserFamilyForApiToken({ uid: session.uid, email: session.email });
  if (!context.familyId) {
    return {
      error: NextResponse.json({ error: "family_not_found" }, { status: 404 }) as NextResponse,
    };
  }
  return { session, familyId: context.familyId };
}

/** GET — per-child enablement status. */
export async function GET(request: NextRequest, ctx: Ctx) {
  const gate = await requireAdminFamily(request);
  if (gate.error) return gate.error;
  const { playerId } = await ctx.params;
  const link = await getAthenaChildLink(gate.familyId, playerId);
  const connection = await getAthenaConnection(gate.familyId);
  return NextResponse.json({
    playerId,
    enabled: Boolean(link),
    familyConnected: Boolean(connection?.connected),
    athenaChildUuid: link?.childUuid || "",
  });
}

/**
 * POST — enable Athena for this child. Athena tries to match by the child's
 * email; if it can't, it returns the parent's Athena children so the UI can
 * prompt the parent to pick one (`childUuid`) or create a new one (`createNew`).
 */
export async function POST(request: NextRequest, ctx: Ctx) {
  const gate = await requireAdminFamily(request);
  if (gate.error) return gate.error;
  const { session, familyId } = gate;
  const { playerId } = await ctx.params;

  const connection = await getAthenaConnection(familyId);
  if (!connection?.connected) {
    return NextResponse.json(
      { error: "not_connected", message: "Connect Athena from your profile first." },
      { status: 400 },
    );
  }

  const member = await loadMember(familyId, playerId);
  if (!member || member.role !== "player") {
    return NextResponse.json(
      { error: "not_found", message: "That child could not be found." },
      { status: 404 },
    );
  }

  let body: { childUuid?: unknown; createNew?: unknown } = {};
  try {
    body = (await request.json()) as { childUuid?: unknown; createNew?: unknown };
  } catch {
    // No body is fine — first attempt relies on email auto-match.
  }
  const childUuid = typeof body.childUuid === "string" ? body.childUuid : undefined;
  const createNew = body.createNew === true;

  try {
    const result = await connectAthenaChild({
      email: session.email,
      playerId,
      displayName: member.displayName,
      childEmail: member.email || undefined,
      childUuid,
      createNew,
    });
    await saveAthenaChildLink(familyId, playerId, {
      childUuid: result.child_uuid,
      displayName: result.display_name || member.displayName,
      enabledByUid: session.uid,
    });
    return NextResponse.json(
      { enabled: true, playerId, athenaChildUuid: result.child_uuid },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof AthenaIntegrationError) {
      if (error.code === "needs_selection") {
        return NextResponse.json(
          {
            needsSelection: true,
            athenaChildren: (error.data as AthenaChildSummary[]) ?? [],
            message: "Pick which Athena child this is, or create a new one.",
          },
          { status: 409 },
        );
      }
      if (error.code === "config_error") {
        console.error("[ATHENA_CHILD_CONFIG_ERROR]", error.message);
      }
      return NextResponse.json({ error: error.code, message: error.userMessage }, { status: error.status });
    }
    throw error;
  }
}

/** DELETE — disable Athena for this child (best-effort remote + local clear). */
export async function DELETE(request: NextRequest, ctx: Ctx) {
  const gate = await requireAdminFamily(request);
  if (gate.error) return gate.error;
  const { session, familyId } = gate;
  const { playerId } = await ctx.params;

  try {
    await disconnectAthenaChild({ email: session.email, playerId });
  } catch (error) {
    console.warn(
      "[ATHENA_CHILD_DISCONNECT_REMOTE_FAILED]",
      error instanceof Error ? error.message : error,
    );
  }
  await deleteAthenaChildLink(familyId, playerId);
  return NextResponse.json({ enabled: false, playerId });
}
