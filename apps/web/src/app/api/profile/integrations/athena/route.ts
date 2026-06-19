import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import {
  ATHENA_TOKEN_NAME,
  ATHENA_TOKEN_SCOPES,
  AthenaIntegrationError,
  connectAthena,
  disconnectAthena,
  getAthenaConfig,
  isAthenaConfigured,
} from "@/lib/integrations/athena";
import {
  clearAthenaConnection,
  getAthenaConnection,
  saveAthenaConnection,
} from "@/lib/integrations/athena-store";
import {
  createApiToken,
  getApiTokenById,
  getClientIp,
  resolveUserFamilyForApiToken,
  updateApiTokenStatus,
} from "@/lib/public-api/tokens";

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

function forbidden() {
  return NextResponse.json(
    { error: "forbidden", message: "Only a parent or admin can connect Athena." },
    { status: 403 },
  );
}

/** Shape the card consumes for the connected/not-connected states. */
function statusBody(
  record: Awaited<ReturnType<typeof getAthenaConnection>>,
  canManage: boolean,
) {
  return {
    provider: "athena",
    connected: Boolean(record?.connected),
    configured: isAthenaConfigured(),
    canManage,
    email: record?.connected ? record.email : "",
    displayName: record?.connected ? record.displayName : "",
    playerId: record?.connected ? record.playerId : "",
    familyName: record?.connected ? record.familyName : "",
    createdAccount: record?.connected ? record.createdAccount : false,
    connectedAt: record?.connected ? record.connectedAt : "",
  };
}

/** GET — current connection status for the Integrations card. */
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return unauthorized();
  }
  const canManage = session.role === "admin";
  const context = await resolveUserFamilyForApiToken({
    uid: session.uid,
    email: session.email || "",
  });
  if (!context.familyId) {
    return NextResponse.json(statusBody(null, canManage));
  }
  const record = await getAthenaConnection(context.familyId);
  return NextResponse.json(statusBody(record, canManage));
}

/** POST — one-click "Connect Athena": mint a scoped token + link via Athena. */
export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return unauthorized();
  }
  // Parent/admin only. Athena also enforces this server-side (403), but we gate
  // here so child/"player" accounts never even mint a token.
  if (session.role !== "admin") {
    return forbidden();
  }
  if (!session.email) {
    return NextResponse.json(
      { error: "invalid_request", message: "Couldn't connect — make sure your account has an email set." },
      { status: 400 },
    );
  }

  // Config (partner secret + URLs) must be present. Missing config is our error.
  let config;
  try {
    config = getAthenaConfig();
  } catch (error) {
    console.error("[ATHENA_CONFIG_ERROR]", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: "config_error", message: "Connection failed, please try again later." },
      { status: 502 },
    );
  }

  const context = await resolveUserFamilyForApiToken({
    uid: session.uid,
    email: session.email,
  });
  if (!context.familyId) {
    return NextResponse.json(
      { error: "family_not_found", message: "Couldn't connect — we couldn't find your family." },
      { status: 404 },
    );
  }

  // Idempotent: if already connected, just return the current state.
  const existing = await getAthenaConnection(context.familyId);
  if (existing?.connected) {
    return NextResponse.json(statusBody(existing, true));
  }

  const common = {
    ipAddress: getClientIp(request),
    userAgent: request.headers.get("user-agent") || "",
  };

  // 1. Mint a minimal, read-only token scoped to this user's family.
  const minted = await createApiToken({
    userId: session.uid,
    familyId: context.familyId,
    name: ATHENA_TOKEN_NAME,
    scopes: [...ATHENA_TOKEN_SCOPES],
    ...common,
  });

  try {
    // 2. Hand the token to Athena server-to-server.
    const result = await connectAthena({
      apiToken: minted.rawToken,
      baseUrl: config.apiBaseUrl,
      config,
    });

    // 3. Persist that we're connected so the card renders connected on reload.
    await saveAthenaConnection(context.familyId, {
      connectedByUid: session.uid,
      email: result.email || session.email,
      playerId: result.player_id || "",
      displayName: result.display_name || "",
      familyName: result.family_name || context.familyName,
      createdAccount: Boolean(result.created_account),
      apiTokenId: minted.token.id,
    });

    const record = await getAthenaConnection(context.familyId);
    return NextResponse.json(statusBody(record, true), { status: 201 });
  } catch (error) {
    // Connect failed — revoke the token we just minted so we don't leave an
    // orphaned credential lying around.
    await updateApiTokenStatus({ token: minted.token, action: "delete", ...common }).catch(() => {});

    if (error instanceof AthenaIntegrationError) {
      if (error.code === "config_error") {
        console.error("[ATHENA_CONNECT_CONFIG_ERROR]", error.message);
      }
      return NextResponse.json(
        { error: error.code, message: error.userMessage },
        { status: error.status },
      );
    }
    throw error;
  }
}

/** DELETE — "Disconnect": sever in Athena, revoke our token, clear local state. */
export async function DELETE(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return unauthorized();
  }
  if (session.role !== "admin") {
    return forbidden();
  }

  const context = await resolveUserFamilyForApiToken({
    uid: session.uid,
    email: session.email || "",
  });
  if (!context.familyId) {
    return NextResponse.json({ provider: "athena", connected: false });
  }

  const existing = await getAthenaConnection(context.familyId);
  const identifierEmail = existing?.email || session.email || "";

  // Tell Athena to sever the link (best-effort — never block local cleanup).
  if (isAthenaConfigured() && identifierEmail) {
    try {
      await disconnectAthena({ email: identifierEmail });
    } catch (error) {
      console.warn(
        "[ATHENA_DISCONNECT_REMOTE_FAILED]",
        error instanceof Error ? error.message : error,
      );
    }
  }

  // Revoke the Family Chores token we issued to Athena so its stored copy dies.
  if (existing?.apiTokenId) {
    try {
      const token = await getApiTokenById(existing.apiTokenId);
      if (token && token.status !== "deleted") {
        await updateApiTokenStatus({
          token,
          action: "delete",
          ipAddress: getClientIp(request),
          userAgent: request.headers.get("user-agent") || "",
        });
      }
    } catch (error) {
      console.warn(
        "[ATHENA_DISCONNECT_TOKEN_REVOKE_FAILED]",
        error instanceof Error ? error.message : error,
      );
    }
  }

  // Clear our local connected record.
  if (existing) {
    await clearAthenaConnection(context.familyId);
  }

  return NextResponse.json({ provider: "athena", connected: false });
}
