/**
 * Server-only client for the "Athena Learning Companion AI" partner integration.
 *
 * All calls are server-to-server: the shared partner secret (X-Partner-Key) and
 * the Family Chores API token we mint for Athena must NEVER reach the browser.
 * Only this module (and the API routes that use it) ever sees them.
 *
 * Athena strips trailing slashes from `baseUrl` and appends `/api/v1/...`, so
 * `baseUrl` must be our public ORIGIN (e.g. https://api.familychores.app), not
 * a path under /api/v1.
 *
 * This module reads server-only secrets (the partner key) and must only be
 * imported from server code (API route handlers), never a client component.
 */

export const ATHENA_PROVIDER = "athena";

/**
 * Scopes the minted token grants Athena. Read-only — Athena can view Family
 * Chores data but never change it.
 */
export const ATHENA_TOKEN_SCOPES = [
  "read:profile",
  "read:players",
  "read:coins",
  "read:chores",
] as const;

export const ATHENA_TOKEN_NAME = "Athena Learning Companion AI";

const DEFAULT_TIMEOUT_MS = 10_000;
/**
 * Generation endpoints (Gemini-backed) routinely take longer than the default,
 * especially on a cold call with rich context. Give them real headroom so we
 * don't abort a perfectly good response and fall back to local suggestions.
 */
const GENERATION_TIMEOUT_MS = 30_000;
/** Fire-and-forget memory write — short timeout so it never delays the response much. */
const REMEMBER_TIMEOUT_MS = 5_000;

export type AthenaConfig = {
  proxyBaseUrl: string;
  partnerKey: string;
  apiBaseUrl: string;
};

/**
 * Categorised outcome of an Athena call. `code` drives both the HTTP status we
 * return to our own client and the user-facing message shown on the card.
 *
 * - invalid_request  → Athena 400 (bad/missing email, player not resolved)
 * - forbidden        → Athena 403 (token owner isn't a parent/admin)
 * - config_error     → Athena 401 (bad partner secret) or missing local config
 * - upstream_error   → Athena 502 (Athena couldn't reach our API) / network / 5xx
 * - unknown_error    → anything else
 */
export type AthenaErrorCode =
  | "invalid_request"
  | "forbidden"
  | "config_error"
  | "upstream_error"
  | "needs_selection"
  | "unknown_error";

export class AthenaIntegrationError extends Error {
  readonly code: AthenaErrorCode;
  readonly status: number;
  readonly userMessage: string;
  /** Extra payload for non-fatal outcomes (e.g. the children list on 409). */
  readonly data?: unknown;

  constructor(
    code: AthenaErrorCode,
    userMessage: string,
    status: number,
    message?: string,
    data?: unknown,
  ) {
    super(message ?? userMessage);
    this.name = "AthenaIntegrationError";
    this.code = code;
    this.status = status;
    this.userMessage = userMessage;
    this.data = data;
  }
}

const USER_MESSAGES: Record<AthenaErrorCode, string> = {
  invalid_request: "Couldn't connect — make sure your account has an email set.",
  forbidden: "Only a parent or admin can connect Athena.",
  config_error: "Connection failed, please try again later.",
  upstream_error: "Temporary problem, try again.",
  needs_selection: "Choose which Athena child to link.",
  unknown_error: "Connection failed, please try again later.",
};

/** HTTP status we surface to our own browser client for each category. */
const CLIENT_STATUS: Record<AthenaErrorCode, number> = {
  invalid_request: 400,
  forbidden: 403,
  config_error: 502,
  upstream_error: 502,
  needs_selection: 409,
  unknown_error: 502,
};

function athenaError(code: AthenaErrorCode, detail?: string, data?: unknown) {
  return new AthenaIntegrationError(code, USER_MESSAGES[code], CLIENT_STATUS[code], detail, data);
}

/**
 * Read + validate Athena configuration from the environment. Throws a
 * `config_error` (which we log and surface as a generic message) when the
 * partner secret or proxy base URL is missing.
 */
export function getAthenaConfig(): AthenaConfig {
  const proxyBaseUrl = (process.env.ATHENA_PROXY_BASE_URL || "").trim().replace(/\/+$/, "");
  const partnerKey = (process.env.ATHENA_PARTNER_KEY || "").trim();
  const apiBaseUrl = (
    process.env.FAMILY_CHORES_PUBLIC_API_BASE_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    ""
  )
    .trim()
    .replace(/\/+$/, "");

  if (!proxyBaseUrl || !partnerKey) {
    throw athenaError("config_error", "ATHENA_PROXY_BASE_URL_OR_ATHENA_PARTNER_KEY_MISSING");
  }
  if (!apiBaseUrl) {
    throw athenaError("config_error", "FAMILY_CHORES_PUBLIC_API_BASE_URL_MISSING");
  }
  return { proxyBaseUrl, partnerKey, apiBaseUrl };
}

export function isAthenaConfigured() {
  try {
    getAthenaConfig();
    return true;
  } catch {
    return false;
  }
}

/** Map an Athena HTTP status to one of our error categories. */
function mapStatusToError(status: number): AthenaIntegrationError {
  if (status === 400) return athenaError("invalid_request", "ATHENA_HTTP_400");
  if (status === 401) return athenaError("config_error", "ATHENA_HTTP_401");
  if (status === 403) return athenaError("forbidden", "ATHENA_HTTP_403");
  if (status === 502) return athenaError("upstream_error", "ATHENA_HTTP_502");
  if (status >= 500) return athenaError("upstream_error", `ATHENA_HTTP_${status}`);
  return athenaError("unknown_error", `ATHENA_HTTP_${status}`);
}

async function postAthena<T>(
  config: AthenaConfig,
  path: string,
  body: Record<string, unknown>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<{ status: number; data: T }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${config.proxyBaseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Partner-Key": config.partnerKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (error) {
    // Network failure / timeout reaching Athena — treat as a transient upstream
    // problem the user can retry.
    throw athenaError("upstream_error", error instanceof Error ? error.message : "ATHENA_FETCH_FAILED");
  } finally {
    clearTimeout(timeout);
  }

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    if (response.status === 401) {
      // Config error on OUR side (bad/missing X-Partner-Key). Log it.
      console.error("[ATHENA_PARTNER_KEY_REJECTED]", { path, status: response.status });
    }
    // 409 = the child couldn't be auto-matched; Athena returns the candidate
    // children so the parent can pick one or create a new one.
    if (response.status === 409 && data && typeof data === "object" && (data as { needsSelection?: boolean }).needsSelection) {
      throw athenaError("needs_selection", "ATHENA_HTTP_409", (data as { children?: unknown }).children ?? []);
    }
    throw mapStatusToError(response.status);
  }

  return { status: response.status, data: data as T };
}

export type AthenaConnectResult = {
  success: boolean;
  connected: boolean;
  created_account: boolean;
  email: string;
  display_name: string;
  player_id: string;
  family_name: string;
};

/**
 * Link a family to Athena. `apiToken` is the Family Chores token we minted for
 * Athena; `baseUrl` is our public API origin so Athena knows where to call.
 */
export async function connectAthena(input: {
  apiToken: string;
  baseUrl: string;
  config?: AthenaConfig;
}): Promise<AthenaConnectResult> {
  const config = input.config ?? getAthenaConfig();
  const { data } = await postAthena<AthenaConnectResult>(
    config,
    "/api/v1/integrations/family-chores/connect",
    { apiToken: input.apiToken, baseUrl: input.baseUrl },
  );
  return data;
}

export type AthenaDisconnectResult = {
  success: boolean;
  disconnected: boolean;
};

/** Sever the Athena link. Any one identifier (email/playerId/apiToken) works. */
export async function disconnectAthena(input: {
  email?: string;
  playerId?: string;
  apiToken?: string;
  config?: AthenaConfig;
}): Promise<AthenaDisconnectResult> {
  const config = input.config ?? getAthenaConfig();
  const body: Record<string, unknown> = {};
  if (input.email) body.email = input.email;
  if (input.playerId) body.playerId = input.playerId;
  if (input.apiToken) body.apiToken = input.apiToken;
  const { data } = await postAthena<AthenaDisconnectResult>(
    config,
    "/api/v1/integrations/family-chores/disconnect",
    body,
  );
  return data;
}

export type AthenaChildSummary = {
  childUuid: string;
  displayName: string;
  email: string | null;
  linkedPlayerId: string | null;
};

export type AthenaListChildrenResult = {
  success: boolean;
  matchedChildUuid: string | null;
  children: AthenaChildSummary[];
};

/** List the parent's Athena children so the parent can pick one to link. */
export async function listAthenaChildren(input: {
  email: string;
  childEmail?: string;
  config?: AthenaConfig;
}): Promise<AthenaListChildrenResult> {
  const config = input.config ?? getAthenaConfig();
  const body: Record<string, unknown> = { email: input.email };
  if (input.childEmail) body.childEmail = input.childEmail;
  const { data } = await postAthena<AthenaListChildrenResult>(
    config,
    "/api/v1/integrations/family-chores/children",
    body,
  );
  return data;
}

export type AthenaConnectChildResult = {
  success: boolean;
  connected: boolean;
  child_uuid: string;
  display_name: string;
  player_id: string;
  created_account: boolean;
};

/**
 * Link a Family Chores child player to an Athena child profile. When the child
 * can't be auto-matched and no `childUuid`/`createNew` is supplied, Athena
 * replies 409 — surfaced here as `AthenaIntegrationError` code `needs_selection`
 * carrying the `children` list to choose from.
 */
export async function connectAthenaChild(input: {
  email: string;
  playerId: string;
  displayName?: string;
  childUuid?: string;
  childEmail?: string;
  createNew?: boolean;
  config?: AthenaConfig;
}): Promise<AthenaConnectChildResult> {
  const config = input.config ?? getAthenaConfig();
  const body: Record<string, unknown> = { email: input.email, playerId: input.playerId };
  if (input.displayName) body.displayName = input.displayName;
  if (input.childUuid) body.childUuid = input.childUuid;
  if (input.childEmail) body.childEmail = input.childEmail;
  if (input.createNew) body.createNew = true;
  const { data } = await postAthena<AthenaConnectChildResult>(
    config,
    "/api/v1/integrations/family-chores/connect-child",
    body,
  );
  return data;
}

/** Remove a per-child link by Family Chores playerId. */
export async function disconnectAthenaChild(input: {
  email: string;
  playerId: string;
  config?: AthenaConfig;
}): Promise<{ success: boolean; disconnected: boolean }> {
  const config = input.config ?? getAthenaConfig();
  const { data } = await postAthena<{ success: boolean; disconnected: boolean }>(
    config,
    "/api/v1/integrations/family-chores/disconnect-child",
    { email: input.email, playerId: input.playerId },
  );
  return data;
}

export type AthenaChoreSuggestion = {
  title: string;
  description: string;
  suggestedCoinValue: number;
  ageAppropriate: boolean;
  rationale: string;
};

export type AthenaSuggestChoresResult = {
  success: boolean;
  suggestions: AthenaChoreSuggestion[];
};

/**
 * Ask Athena (Gemini) for STRUCTURED ghost-chore suggestions. Server-to-server,
 * authorized by the partner secret. The whole `payload` is the sanitized context
 * (see `GhostChoreSuggestRequest`); the raw response is returned untyped so the
 * caller can validate/clamp it with `parseAthenaGhostResponse` before use.
 */
export async function suggestGhostChoresWithAthena(input: {
  payload: Record<string, unknown>;
  config?: AthenaConfig;
}): Promise<unknown> {
  const config = input.config ?? getAthenaConfig();
  const { data } = await postAthena<unknown>(
    config,
    "/api/v1/integrations/family-chores/suggest-ghost-chores",
    input.payload,
    GENERATION_TIMEOUT_MS,
  );
  return data;
}

export type AthenaRememberSignal = {
  suggestionType?: string;
  pillar?: string | null;
  category?: string | null;
  difficulty?: string;
  title?: string;
};

/**
 * Tell Athena that the family accepted an Athena chore suggestion, so she can
 * record a distilled, family-visible preference in the linked child's memory.
 * Best-effort and idempotent on Athena's side; a short timeout keeps it from
 * delaying the chore-creation response. No-ops gracefully when the child has no
 * linked Athena profile.
 */
export async function rememberAthenaPreference(input: {
  email: string;
  playerId: string;
  signal: AthenaRememberSignal;
  config?: AthenaConfig;
}): Promise<{ remembered: boolean }> {
  const config = input.config ?? getAthenaConfig();
  const { data } = await postAthena<{ remembered?: boolean }>(
    config,
    "/api/v1/integrations/family-chores/remember",
    { email: input.email, playerId: input.playerId, signal: input.signal },
    REMEMBER_TIMEOUT_MS,
  );
  return { remembered: Boolean(data?.remembered) };
}

/** Ask Athena (Gemini) for age-appropriate chore ideas. Stateless, read-only. */
export async function suggestChoresWithAthena(input: {
  child: { displayName: string; age?: number; interests?: string[] };
  existingChores?: Array<{ title: string; coinValue?: number }>;
  count?: number;
  context?: string;
  config?: AthenaConfig;
}): Promise<AthenaSuggestChoresResult> {
  const config = input.config ?? getAthenaConfig();
  const body: Record<string, unknown> = { child: input.child };
  if (input.existingChores) body.existingChores = input.existingChores;
  if (typeof input.count === "number") body.count = input.count;
  if (input.context) body.context = input.context;
  const { data } = await postAthena<AthenaSuggestChoresResult>(
    config,
    "/api/v1/integrations/family-chores/suggest-chores",
    body,
  );
  return data;
}
