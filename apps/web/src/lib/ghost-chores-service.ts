import { randomUUID } from "node:crypto";
import {
  adminCreateOrReplaceDocument,
  adminGetDocument,
  adminListAllDocuments,
  adminListDocuments,
  adminPatchDocument,
} from "@/lib/firestore/admin";
import {
  boolField,
  documentIdFromName,
  integerField,
  readBoolean,
  readInteger,
  readString,
  readStringArray,
  readTimestamp,
  stringArrayField,
  stringField,
  timestampField,
  type FirestoreDocument,
} from "@/lib/firestore/rest";
import {
  buildGhostSuggestionFields,
  generateGhostSuggestions,
  ghostSuggestionKey,
  normalizeGhostCoinValue,
  parseGhostSuggestionRecord,
  resolveGhostSuggestion,
  summarizeGhostSuggestions,
  type FamilyChoreSeed,
  type GhostChoreStatus,
  type GhostChoreSuggestion,
  type GhostChoreSuggestionRecord,
} from "@/lib/ghost-chores";
import { recordOperationMetric } from "@/lib/observability/metrics";
import { getAthenaConnection } from "@/lib/integrations/athena-store";
import {
  AthenaIntegrationError,
  isAthenaConfigured,
  rememberAthenaPreference,
  suggestGhostChoresWithAthena,
  type AthenaRememberSignal,
} from "@/lib/integrations/athena";
import {
  athenaToGhostSuggestion,
  parseAthenaGhostResponse,
} from "@/lib/integrations/ghost-chore-schema";
import { buildGhostChoreRequest, type BuildGhostContextInput } from "@/lib/ghost-chore-context";
import {
  findCachedSuggestion,
  getGhostChoreCache,
  isCacheFresh,
  saveGhostChoreCache,
} from "@/lib/ghost-chore-cache";

export type GhostSuggestionSource = "athena" | "local";

export type GhostViewerRole = "admin" | "player";

export type GhostViewerContext = {
  familyId: string;
  memberId: string;
  role: GhostViewerRole;
  aliases: string[];
  openChoreCount: number;
  openChoreKeys: Set<string>;
  /**
   * Titles of every non-deleted chore the viewer already has, in ANY status
   * (open, submitted, approved-today, or repeating). We never re-suggest these, so a
   * daily chore the player already completed today won't reappear as a ghost suggestion.
   */
  ownedChoreKeys: Set<string>;
};

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function isNotFound(error: unknown) {
  return error instanceof Error && error.message.includes("FIRESTORE_ADMIN_HTTP_404");
}

async function getPrimaryFamilyId(uid: string) {
  try {
    const userDoc = await adminGetDocument(`users/${uid}`);
    return readStringArray(userDoc.fields, "familyIds")[0] ?? "";
  } catch (error) {
    if (isNotFound(error)) {
      return "";
    }
    throw error;
  }
}

function ghostSuggestionsPath(familyId: string) {
  return `families/${familyId}/ghostChoreSuggestions`;
}

/** Create a real chore from a ghost suggestion using the standard chore-creation shape. */
async function writeChoreFromSuggestion(input: {
  familyId: string;
  createdByUid: string;
  title: string;
  details: string;
  categoryIds: string[];
  assigneeId: string;
  assigneeName: string;
  coinValue: number;
  requireApproval: boolean;
  choreType: "normal" | "see_and_do";
  dueDate: string;
  suggestionId: string;
  /** Which engine produced the original suggestion — retained for reporting. */
  suggestionSource: GhostSuggestionSource;
  now: string;
}) {
  const choreId = randomUUID();
  await adminCreateOrReplaceDocument(`families/${input.familyId}/chores/${choreId}`, {
    title: stringField(input.title.trim().slice(0, 160) || input.title),
    choreType: stringField(input.choreType),
    status: stringField("Open"),
    assigneeId: stringField(input.assigneeId),
    assigneeIds: stringArrayField(input.assigneeId ? [input.assigneeId] : []),
    assigneeScope: stringField("single"),
    assigneeName: stringField(input.assigneeName),
    details: stringField((input.details ?? "").slice(0, 2000)),
    categoryIds: stringArrayField((input.categoryIds ?? []).slice(0, 5)),
    dueDate: stringField(input.dueDate),
    coinValue: integerField(normalizeGhostCoinValue(input.coinValue)),
    requireApproval: boolField(input.requireApproval),
    recurrenceType: stringField("none"),
    recurrenceInterval: integerField(0),
    recurrenceUnit: stringField(""),
    deleted: boolField(false),
    createdBy: stringField(input.createdByUid),
    createdAt: timestampField(input.now),
    source: stringField("ghost_chore"),
    suggestionSource: stringField(input.suggestionSource),
    ghostSuggestionId: stringField(input.suggestionId),
  });
  return choreId;
}

async function resolveMemberName(familyId: string, memberId: string) {
  try {
    const doc = await adminGetDocument(`families/${familyId}/members/${memberId}`);
    return readString(doc.fields, "name") || "";
  } catch (error) {
    if (isNotFound(error)) {
      return "";
    }
    throw error;
  }
}

/**
 * Resolve the signed-in viewer's family, role, and their currently-open chores.
 * Returns null when there is no active family for the viewer.
 */
export async function resolveGhostViewerContext(session: {
  uid: string;
  memberId: string;
  email: string;
}): Promise<GhostViewerContext | null> {
  const familyId = await getPrimaryFamilyId(session.uid);
  if (!familyId) {
    return null;
  }

  const memberDocs = await adminListDocuments(`families/${familyId}/members`, 300);
  const normalizedEmail = normalizeEmail(session.email);
  const aliases = new Set<string>([session.uid]);
  if (session.memberId) {
    aliases.add(session.memberId);
  }
  if (normalizedEmail) {
    aliases.add(normalizedEmail);
  }
  let role: GhostViewerRole = "player";
  let memberId = session.memberId || session.uid;

  for (const doc of memberDocs) {
    if (readBoolean(doc.fields, "deleted")) {
      continue;
    }
    const docId = documentIdFromName(doc.name);
    const memberUid = readString(doc.fields, "uid");
    const memberEmail = normalizeEmail(readString(doc.fields, "email"));
    const matchesUid = docId === session.uid || memberUid === session.uid;
    const matchesEmail = Boolean(normalizedEmail) && memberEmail === normalizedEmail;
    if (!matchesUid && !matchesEmail) {
      continue;
    }
    memberId = docId;
    aliases.add(docId);
    if (memberUid) {
      aliases.add(memberUid);
    }
    if (memberEmail) {
      aliases.add(memberEmail);
    }
    if (readString(doc.fields, "role") === "admin") {
      role = "admin";
    }
  }

  const choreDocs = await adminListAllDocuments(`families/${familyId}/chores`, { cap: 500 });
  const openChoreKeys = new Set<string>();
  const ownedChoreKeys = new Set<string>();
  let openChoreCount = 0;
  for (const doc of choreDocs) {
    if (readBoolean(doc.fields, "deleted")) {
      continue;
    }
    const status = readString(doc.fields, "status");
    const assigneeId = readString(doc.fields, "assigneeId");
    const assigneeScope = readString(doc.fields, "assigneeScope");
    const assigneeIds = readStringArray(doc.fields, "assigneeIds");
    const assignedToViewer =
      assigneeScope === "family" ||
      (assigneeId && aliases.has(assigneeId)) ||
      (assigneeId && aliases.has(normalizeEmail(assigneeId))) ||
      assigneeIds.some((id) => aliases.has(id) || aliases.has(normalizeEmail(id)));
    if (!assignedToViewer) {
      continue;
    }
    const titleKey = ghostSuggestionKey(readString(doc.fields, "title"));
    // Never re-suggest a chore the viewer already has, in any status. This covers a
    // daily chore already completed today (status Approved/Submitted) and repeating
    // chores whose next occurrence isn't currently open.
    ownedChoreKeys.add(titleKey);
    if (status === "Open") {
      openChoreCount += 1;
      openChoreKeys.add(titleKey);
    }
  }

  return {
    familyId,
    memberId,
    role,
    aliases: Array.from(aliases),
    openChoreCount,
    openChoreKeys,
    ownedChoreKeys,
  };
}

/** Recent + commonly used family chores, newest first, distinct by title. */
export async function listFamilyChoreSeeds(familyId: string): Promise<FamilyChoreSeed[]> {
  const choreDocs = await adminListAllDocuments(`families/${familyId}/chores`, { cap: 500 });
  const byKey = new Map<string, { seed: FamilyChoreSeed; createdAt: string }>();
  for (const doc of choreDocs) {
    if (readBoolean(doc.fields, "deleted")) {
      continue;
    }
    const title = readString(doc.fields, "title");
    const key = ghostSuggestionKey(title);
    if (!key) {
      continue;
    }
    const createdAt = readTimestamp(doc.fields, "createdAt");
    const existing = byKey.get(key);
    if (existing && existing.createdAt >= createdAt) {
      continue;
    }
    byKey.set(key, {
      createdAt,
      seed: {
        title,
        coinValue: readInteger(doc.fields, "coinValue"),
        categoryIds: readStringArray(doc.fields, "categoryIds"),
        source: "recent_chore",
      },
    });
  }
  return Array.from(byKey.values())
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
    .slice(0, 20)
    .map((entry) => entry.seed);
}

async function listGhostRecords(familyId: string): Promise<GhostChoreSuggestionRecord[]> {
  try {
    const docs = await adminListAllDocuments(ghostSuggestionsPath(familyId), { cap: 500 });
    return docs.map(parseGhostSuggestionRecord);
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    throw error;
  }
}

/** Best-effort analytics for the Athena ghost-chore lifecycle (never throws). */
function trackGhostEvent(
  operation:
    | "ghost_suggestion_requested"
    | "ghost_suggestion_shown"
    | "ghost_suggestion_dismissed"
    | "ghost_suggestion_edited"
    | "ghost_suggestion_approved"
    | "ghost_athena_fallback",
  input: { familyId: string; source?: GhostSuggestionSource; resultCount?: number; errorCode?: string },
) {
  void recordOperationMetric({
    area: "chores",
    operation,
    durationMs: 0,
    familyId: input.familyId,
    resultCount: input.resultCount,
    errorCode: input.errorCode,
    status: input.errorCode ? "error" : "ok",
    metadata: { source: input.source ?? "local" },
  });
}

/**
 * On acceptance of an Athena suggestion, tell Athena so she can record a
 * distilled, family-visible preference in the linked child's memory. Best-effort:
 * never throws, never blocks the (already-created) chore. No-ops when Athena
 * isn't connected/configured or the child has no linked Athena profile.
 */
async function rememberAthenaAcceptance(input: {
  familyId: string;
  playerId: string;
  signal: AthenaRememberSignal;
}): Promise<void> {
  if (!input.playerId || !isAthenaConfigured()) {
    return;
  }
  try {
    const connection = await getAthenaConnection(input.familyId);
    if (!connection?.connected || !connection.email) {
      return;
    }
    const { remembered } = await rememberAthenaPreference({
      email: connection.email,
      playerId: input.playerId,
      signal: input.signal,
    });
    void recordOperationMetric({
      area: "chores",
      operation: "ghost_athena_remember",
      durationMs: 0,
      familyId: input.familyId,
      status: "ok",
      metadata: { remembered },
    });
  } catch (error) {
    console.warn("[GHOST_ATHENA_REMEMBER_SKIPPED]", {
      familyId: input.familyId,
      reason: error instanceof Error ? error.message.slice(0, 80) : "unknown",
    });
  }
}

/**
 * Gather + sanitize the per-subject context Athena needs. Uses admin creds (same
 * as the rest of this module). Returns the input for `buildGhostChoreRequest`
 * plus the subject's role and the title keys we should never re-suggest.
 */
async function gatherAthenaSubjectData(
  familyId: string,
  subjectMemberId: string,
): Promise<{ input: BuildGhostContextInput; excludeKeys: Set<string> } | null> {
  let memberFields;
  try {
    const memberDoc = await adminGetDocument(`families/${familyId}/members/${subjectMemberId}`);
    if (readBoolean(memberDoc.fields, "deleted")) return null;
    memberFields = memberDoc.fields;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }

  const subjectRole: GhostViewerRole = readString(memberFields, "role") === "admin" ? "admin" : "player";
  const subjectUid = readString(memberFields, "uid").trim();
  const subjectEmail = normalizeEmail(readString(memberFields, "email"));
  const birthYearRaw = readInteger(memberFields, "birthYear");
  const aliases = new Set<string>([subjectMemberId]);
  if (subjectUid) aliases.add(subjectUid);
  if (subjectEmail) aliases.add(subjectEmail);

  const [choreDocs, categoryDocs, records, familyDoc] = await Promise.all([
    adminListAllDocuments(`families/${familyId}/chores`, { cap: 500 }),
    adminListDocuments(`families/${familyId}/categories`, 100).catch((e) => {
      if (isNotFound(e)) return [];
      throw e;
    }),
    listGhostRecords(familyId),
    adminGetDocument(`families/${familyId}`).catch((e) => {
      if (isNotFound(e)) return null;
      throw e;
    }),
  ]);

  const categoryNameById = new Map<string, string>();
  for (const doc of categoryDocs) {
    categoryNameById.set(documentIdFromName(doc.name), readString(doc.fields, "name"));
  }
  const categoryName = (ids: string[]) => {
    for (const id of ids) {
      const name = categoryNameById.get(id);
      if (name) return name;
    }
    return undefined;
  };

  const now = new Date();
  const recentCutoff = now.getTime() - 30 * 86_400_000;
  const activeChores: BuildGhostContextInput["activeChores"] = [];
  const recentlyCompleted: BuildGhostContextInput["recentlyCompleted"] = [];
  const pastChores: BuildGhostContextInput["pastChores"] = [];
  const excludeKeys = new Set<string>();
  let totalChoresCompleted = 0;

  for (const doc of choreDocs) {
    if (readBoolean(doc.fields, "deleted")) continue;
    const assigneeId = readString(doc.fields, "assigneeId");
    const assigneeScope = readString(doc.fields, "assigneeScope");
    const assigneeIds = readStringArray(doc.fields, "assigneeIds");
    const assignedToSubject =
      assigneeScope === "family" ||
      (assigneeId && (aliases.has(assigneeId) || aliases.has(normalizeEmail(assigneeId)))) ||
      assigneeIds.some((id) => aliases.has(id) || aliases.has(normalizeEmail(id)));
    if (!assignedToSubject) continue;

    const title = readString(doc.fields, "title");
    if (!title) continue;
    const chore = {
      title,
      coinValue: readInteger(doc.fields, "coinValue"),
      category: categoryName(readStringArray(doc.fields, "categoryIds")),
    };
    const status = readString(doc.fields, "status");
    excludeKeys.add(ghostSuggestionKey(title));
    if (status === "Open") {
      activeChores.push(chore);
      continue;
    }
    if (status === "Approved" || status === "Submitted") {
      if (status === "Approved") totalChoresCompleted += 1;
      const completedAt =
        readTimestamp(doc.fields, "approvedAt") || readTimestamp(doc.fields, "completedAt");
      const completedMs = completedAt ? Date.parse(completedAt) : NaN;
      if (Number.isFinite(completedMs) && completedMs >= recentCutoff) {
        recentlyCompleted.push(chore);
      } else {
        pastChores.push(chore);
      }
    }
  }

  const suggestionActivity = { suggested: [] as Array<{ title: string }>, dismissed: [] as Array<{ title: string }>, accepted: [] as Array<{ title: string }> };
  for (const record of records) {
    const ownedBySubject = aliases.has(record.playerUid) || record.playerMemberId === subjectMemberId;
    if (record.status === "converted") {
      suggestionActivity.accepted.push({ title: record.suggestedTitle });
      excludeKeys.add(ghostSuggestionKey(record.suggestedTitle));
      continue;
    }
    if (!ownedBySubject) continue;
    if (record.status === "dismissed") {
      suggestionActivity.dismissed.push({ title: record.suggestedTitle });
      excludeKeys.add(ghostSuggestionKey(record.suggestedTitle));
    } else if (record.status === "requested") {
      suggestionActivity.suggested.push({ title: record.suggestedTitle });
      excludeKeys.add(ghostSuggestionKey(record.suggestedTitle));
    }
  }

  let coinBalance: number | undefined;
  if (subjectUid) {
    try {
      const userDoc = await adminGetDocument(`users/${subjectUid}`);
      coinBalance = Math.max(0, readInteger(userDoc.fields, "walletBalance"));
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  const startedAt =
    readTimestamp(memberFields, "createdAt") ||
    (familyDoc ? readTimestamp(familyDoc.fields, "createdAt") : "") ||
    undefined;

  return {
    excludeKeys,
    input: {
      subject: {
        id: subjectMemberId,
        role: subjectRole,
        displayName: readString(memberFields, "name") || undefined,
        birthYear: birthYearRaw > 0 ? birthYearRaw : undefined,
      },
      startedAt,
      totalChoresCompleted,
      coinBalance,
      activeChores,
      recentlyCompleted,
      pastChores,
      suggestionActivity,
      categories: Array.from(categoryNameById.values()).filter(Boolean),
      familySettings: { requireApproval: true },
      now,
    },
  };
}

/**
 * Try to produce Athena-powered suggestions for a subject. Returns null when
 * Athena is not connected/configured, errors, or yields nothing usable — the
 * caller then falls back to the local engine. Serves a fresh cached batch within
 * the TTL to rate-limit/cost-control the model.
 */
async function tryAthenaGhostSuggestions(input: {
  familyId: string;
  subjectMemberId: string;
  limit: number;
}): Promise<GhostChoreSuggestion[] | null> {
  const { familyId, subjectMemberId, limit } = input;
  // One concise diagnostic per fallback reason so a silent "no Athena suggestions"
  // is debuggable from server logs. Never logs child PII — only the reason + ids.
  const fallback = (reason: string) => {
    console.warn("[GHOST_ATHENA_FALLBACK]", { familyId, subjectMemberId, reason });
    return null;
  };

  if (!isAthenaConfigured()) return fallback("not_configured");

  let connection;
  try {
    connection = await getAthenaConnection(familyId);
  } catch (error) {
    return fallback(`connection_read_error:${error instanceof Error ? error.message.slice(0, 80) : "unknown"}`);
  }
  if (!connection?.connected) return fallback("not_connected");

  // Serve a fresh cached batch without re-calling the model.
  try {
    const cached = await getGhostChoreCache(familyId, subjectMemberId);
    if (isCacheFresh(cached) && cached && cached.suggestions.length > 0) {
      return cached.suggestions.slice(0, limit);
    }
  } catch {
    // fall through to a live call
  }

  let gathered;
  try {
    gathered = await gatherAthenaSubjectData(familyId, subjectMemberId);
  } catch (error) {
    return fallback(`gather_error:${error instanceof Error ? error.message.slice(0, 80) : "unknown"}`);
  }
  if (!gathered) return fallback("subject_not_found");

  try {
    const payload = buildGhostChoreRequest({ ...gathered.input, count: Math.min(12, Math.max(limit, 6)) });
    const raw = await suggestGhostChoresWithAthena({ payload: payload as unknown as Record<string, unknown> });
    const { suggestions: athenaSuggestions, meta } = parseAthenaGhostResponse(raw, {
      forceParentReview: gathered.input.subject.role !== "admin",
    });
    if (athenaSuggestions.length === 0) {
      trackGhostEvent("ghost_athena_fallback", { familyId, errorCode: "empty_response" });
      return fallback("empty_response");
    }
    const mapped = athenaSuggestions
      .map(athenaToGhostSuggestion)
      .filter((s) => !gathered.excludeKeys.has(ghostSuggestionKey(s.suggestedTitle)));
    if (mapped.length === 0) {
      trackGhostEvent("ghost_athena_fallback", { familyId, errorCode: "all_excluded" });
      return fallback("all_excluded");
    }
    await saveGhostChoreCache(familyId, subjectMemberId, mapped, meta.modelVersion);
    trackGhostEvent("ghost_suggestion_shown", { familyId, source: "athena", resultCount: mapped.length });
    return mapped.slice(0, limit);
  } catch (error) {
    const errorCode = error instanceof AthenaIntegrationError ? error.code : "athena_error";
    const detail = error instanceof Error ? error.message.slice(0, 100) : "unknown";
    trackGhostEvent("ghost_athena_fallback", { familyId, errorCode });
    return fallback(`request_error:${errorCode}:${detail}`);
  }
}

/**
 * Build the ghost chore suggestions to show a viewer. Players only receive
 * suggestions when they have no open chores; admins always get a preview.
 *
 * When Athena is connected for the family it becomes the primary recommendation
 * engine for the subject (the viewer, or an admin-selected member); on any
 * failure, empty result, or when Athena is not connected we fall back to the
 * deterministic local engine. `source` tells the caller which path produced the
 * suggestions.
 */
export async function getGhostSuggestionsForViewer(
  context: GhostViewerContext,
  limit?: number,
  opts?: { subjectMemberId?: string },
): Promise<{ suggestions: GhostChoreSuggestion[]; hasOpenChores: boolean; source: GhostSuggestionSource }> {
  const hasOpenChores = context.openChoreCount > 0;
  if (context.role === "player" && hasOpenChores) {
    return { suggestions: [], hasOpenChores, source: "local" };
  }

  const subjectMemberId = (opts?.subjectMemberId || context.memberId || "").trim() || context.memberId;
  const effectiveLimit = Math.max(1, Math.min(limit ?? 9, 20));

  // Athena-first when connected; fall back to local on any miss.
  const athena = subjectMemberId
    ? await tryAthenaGhostSuggestions({ familyId: context.familyId, subjectMemberId, limit: effectiveLimit })
    : null;
  if (athena && athena.length > 0) {
    return { suggestions: athena, hasOpenChores, source: "athena" };
  }

  const [familyChores, records] = await Promise.all([
    listFamilyChoreSeeds(context.familyId),
    listGhostRecords(context.familyId),
  ]);

  const excludeKeys = new Set<string>([...context.openChoreKeys, ...context.ownedChoreKeys]);
  for (const record of records) {
    // Hide a player's own dismissed/requested suggestions and any already-converted ones.
    const ownedByViewer = record.playerUid === context.aliases[0] || context.aliases.includes(record.playerUid);
    if (record.status === "converted") {
      excludeKeys.add(ghostSuggestionKey(record.suggestedTitle));
      continue;
    }
    if (!ownedByViewer) {
      continue;
    }
    if (record.status === "dismissed" || record.status === "requested") {
      excludeKeys.add(ghostSuggestionKey(record.suggestedTitle));
    }
  }

  const suggestions = generateGhostSuggestions({ familyChores, excludeKeys, limit });
  return { suggestions, hasOpenChores, source: "local" };
}

async function getGhostRecord(familyId: string, suggestionId: string): Promise<GhostChoreSuggestionRecord | null> {
  try {
    return parseGhostSuggestionRecord(await adminGetDocument(`${ghostSuggestionsPath(familyId)}/${suggestionId}`));
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

/**
 * Resolve a suggestion's full content by id for an action (request/dismiss/add).
 * Athena suggestions aren't in the deterministic pool, so we check each candidate
 * subject's short-TTL cache first, then fall back to the local pool. This keeps
 * the lifecycle uniform across local and Athena suggestions.
 */
async function resolveGhostSuggestionWithCache(
  familyId: string,
  subjectCandidates: Array<string | undefined>,
  suggestionId: string,
  familyChores: FamilyChoreSeed[],
): Promise<GhostChoreSuggestion | null> {
  for (const sid of subjectCandidates) {
    if (!sid) continue;
    try {
      const cache = await getGhostChoreCache(familyId, sid);
      const found = findCachedSuggestion(cache, suggestionId);
      if (found) return found;
    } catch {
      // best-effort; try the next candidate / the local pool
    }
  }
  return resolveGhostSuggestion(suggestionId, familyChores);
}

export type GhostActionResult =
  | { ok: true; record: GhostChoreSuggestionRecord }
  | { ok: false; error: "not_found" | "duplicate_request" | "invalid_status" | "forbidden" };

/** Player requests a suggested chore. Idempotent doc id blocks duplicate pending requests. */
export async function requestGhostSuggestion(input: {
  context: GhostViewerContext;
  suggestionId: string;
  requestedByUid: string;
}): Promise<GhostActionResult> {
  const { context, suggestionId } = input;
  const existing = await getGhostRecord(context.familyId, suggestionId);
  if (existing && existing.status === "requested") {
    return { ok: false, error: "duplicate_request" };
  }
  if (existing && (existing.status === "approved" || existing.status === "converted")) {
    return { ok: false, error: "invalid_status" };
  }

  const familyChores = await listFamilyChoreSeeds(context.familyId);
  const suggestion = await resolveGhostSuggestionWithCache(
    context.familyId,
    [context.memberId],
    suggestionId,
    familyChores,
  );
  if (!suggestion) {
    return { ok: false, error: "not_found" };
  }

  const now = new Date().toISOString();
  const fields = buildGhostSuggestionFields({
    familyId: context.familyId,
    suggestion,
    playerUid: input.requestedByUid,
    playerMemberId: context.memberId,
    status: "requested",
    now,
    requestedByUid: input.requestedByUid,
    upvotes: existing?.upvotes ?? 0,
    downvotes: existing?.downvotes ?? 0,
  });
  await adminCreateOrReplaceDocument(`${ghostSuggestionsPath(context.familyId)}/${suggestionId}`, fields);
  trackGhostEvent("ghost_suggestion_requested", {
    familyId: context.familyId,
    source: suggestion.source === "athena" ? "athena" : "local",
  });
  return { ok: true, record: parseGhostSuggestionRecord({ name: `/${suggestionId}`, fields }) };
}

/** Player/admin dismisses a suggestion. Dismissing records a backend downvote. */
export async function dismissGhostSuggestion(input: {
  context: GhostViewerContext;
  suggestionId: string;
  /** Subject the suggestion was generated for (admin acting on a child's cache). */
  subjectMemberId?: string;
}): Promise<GhostActionResult> {
  const { context, suggestionId } = input;
  const existing = await getGhostRecord(context.familyId, suggestionId);
  const familyChores = await listFamilyChoreSeeds(context.familyId);
  const suggestion = await resolveGhostSuggestionWithCache(
    context.familyId,
    [input.subjectMemberId, context.memberId],
    suggestionId,
    familyChores,
  );
  if (!suggestion) {
    return { ok: false, error: "not_found" };
  }
  const now = new Date().toISOString();
  const fields = buildGhostSuggestionFields({
    familyId: context.familyId,
    suggestion,
    playerUid: context.aliases[0],
    playerMemberId: context.memberId,
    status: "dismissed",
    now,
    upvotes: existing?.upvotes ?? 0,
    downvotes: (existing?.downvotes ?? 0) + 1,
  });
  await adminCreateOrReplaceDocument(`${ghostSuggestionsPath(context.familyId)}/${suggestionId}`, fields);
  trackGhostEvent("ghost_suggestion_dismissed", {
    familyId: context.familyId,
    source: suggestion.source === "athena" ? "athena" : "local",
  });
  return { ok: true, record: parseGhostSuggestionRecord({ name: `/${suggestionId}`, fields }) };
}

/**
 * Add a suggested chore directly (the new dashboard empty-state flow). Admins create a
 * normal real chore assigned to the selected member; players create a `see_and_do` chore
 * assigned to themselves (which still requires admin approval to pay out). Adding records
 * a backend upvote so popular suggestions can be surfaced/reported.
 */
export async function addGhostSuggestion(input: {
  context: GhostViewerContext;
  suggestionId: string;
  actorUid: string;
  actorName: string;
  actorEmail: string;
  assigneeId?: string;
  assigneeName?: string;
}): Promise<{ ok: true; choreId: string } | { ok: false; error: "not_found" }> {
  const { context, suggestionId } = input;
  const existing = await getGhostRecord(context.familyId, suggestionId);
  const familyChores = await listFamilyChoreSeeds(context.familyId);
  const suggestion = await resolveGhostSuggestionWithCache(
    context.familyId,
    [input.assigneeId, context.memberId],
    suggestionId,
    familyChores,
  );
  if (!suggestion) {
    return { ok: false, error: "not_found" };
  }

  const now = new Date().toISOString();
  const isPlayer = context.role !== "admin";
  const assigneeId = isPlayer ? context.memberId : (input.assigneeId ?? "").trim();
  let assigneeName = isPlayer ? input.actorName : (input.assigneeName ?? "").trim();
  if (!assigneeName && assigneeId) {
    assigneeName = await resolveMemberName(context.familyId, assigneeId);
  }
  if (!assigneeName) {
    assigneeName = isPlayer ? input.actorName || "Me" : "Unassigned";
  }

  const choreId = await writeChoreFromSuggestion({
    familyId: context.familyId,
    createdByUid: input.actorUid,
    title: suggestion.suggestedTitle,
    details: suggestion.suggestedDescription,
    categoryIds: suggestion.suggestedCategoryIds,
    assigneeId,
    assigneeName,
    coinValue: isPlayer ? 0 : suggestion.suggestedCoinValue,
    requireApproval: true,
    choreType: isPlayer ? "see_and_do" : "normal",
    dueDate: now.slice(0, 10),
    suggestionId,
    suggestionSource: suggestion.source === "athena" ? "athena" : "local",
    now,
  });

  const fields = buildGhostSuggestionFields({
    familyId: context.familyId,
    suggestion,
    playerUid: input.actorUid,
    playerMemberId: context.memberId,
    status: "converted",
    now,
    convertedChoreId: choreId,
    upvotes: (existing?.upvotes ?? 0) + 1,
    downvotes: existing?.downvotes ?? 0,
  });
  await adminCreateOrReplaceDocument(`${ghostSuggestionsPath(context.familyId)}/${suggestionId}`, fields);

  await writeGhostActivity({
    familyId: context.familyId,
    kind: "ghost_chore_added",
    actorUid: input.actorUid,
    actorEmail: input.actorEmail,
    actorName: input.actorName,
    title: "Suggested chore added",
    message: `${input.actorName || "Someone"} added the suggested chore "${suggestion.suggestedTitle}".`,
    choreId,
    choreTitle: suggestion.suggestedTitle,
    relatedIds: [assigneeId].filter(Boolean),
  });

  trackGhostEvent("ghost_suggestion_approved", {
    familyId: context.familyId,
    source: suggestion.source === "athena" ? "athena" : "local",
  });

  if (suggestion.source === "athena") {
    await rememberAthenaAcceptance({
      familyId: context.familyId,
      playerId: assigneeId,
      signal: {
        suggestionType: suggestion.athena?.suggestionType,
        pillar: suggestion.athena?.pillar ?? null,
        category: suggestion.athena?.categoryLabel ?? null,
        difficulty: suggestion.athena?.difficulty,
        title: suggestion.suggestedTitle,
      },
    });
  }

  return { ok: true, choreId };
}

/** Admin: list ghost chore requests awaiting review. */
export async function listRequestedGhostSuggestions(familyId: string): Promise<GhostChoreSuggestionRecord[]> {
  const records = await listGhostRecords(familyId);
  return records
    .filter((record) => record.status === "requested")
    .sort((a, b) => (b.requestedAt || "").localeCompare(a.requestedAt || ""));
}

export async function getFamilyGhostSummary(familyId: string) {
  return summarizeGhostSuggestions(await listGhostRecords(familyId));
}

type ApproveOverrides = {
  assigneeId?: string;
  assigneeName?: string;
  title?: string;
  details?: string;
  coinValue?: number;
  requireApproval?: boolean;
  dueDate?: string;
  categoryIds?: string[];
};

/**
 * Admin approves a requested ghost chore and converts it into a real chore using the
 * standard chore-creation shape. The ghost record is marked `converted` and linked to
 * the created chore. Returns the new chore id.
 */
export async function approveGhostSuggestion(input: {
  familyId: string;
  suggestionId: string;
  reviewerUid: string;
  reviewerName: string;
  reviewerEmail: string;
  overrides?: ApproveOverrides;
}): Promise<{ ok: true; choreId: string } | { ok: false; error: "not_found" | "invalid_status" }> {
  const record = await getGhostRecord(input.familyId, input.suggestionId);
  if (!record) {
    return { ok: false, error: "not_found" };
  }
  if (record.status !== "requested") {
    return { ok: false, error: "invalid_status" };
  }

  const overrides = input.overrides ?? {};
  const now = new Date().toISOString();
  const title = (overrides.title ?? record.suggestedTitle).trim().slice(0, 160) || record.suggestedTitle;
  const assigneeId = (overrides.assigneeId ?? record.playerMemberId ?? "").trim();
  let assigneeName = (overrides.assigneeName ?? "").trim();
  if (!assigneeName && assigneeId) {
    assigneeName = await resolveMemberName(input.familyId, assigneeId);
  }
  if (!assigneeName) {
    assigneeName = "Unassigned";
  }
  const dueDate =
    typeof overrides.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(overrides.dueDate)
      ? overrides.dueDate
      : now.slice(0, 10);

  const choreId = await writeChoreFromSuggestion({
    familyId: input.familyId,
    createdByUid: input.reviewerUid,
    title,
    details: overrides.details ?? record.suggestedDescription ?? "",
    categoryIds: overrides.categoryIds ?? record.suggestedCategoryIds ?? [],
    assigneeId,
    assigneeName,
    coinValue: overrides.coinValue ?? record.suggestedCoinValue,
    requireApproval: overrides.requireApproval ?? true,
    choreType: "normal",
    dueDate,
    suggestionId: input.suggestionId,
    suggestionSource: record.source === "athena" ? "athena" : "local",
    now,
  });

  await adminPatchDocument(
    `${ghostSuggestionsPath(input.familyId)}/${input.suggestionId}`,
    {
      status: stringField("converted"),
      reviewedAt: timestampField(now),
      reviewedByUid: stringField(input.reviewerUid),
      convertedChoreId: stringField(choreId),
      updatedAt: timestampField(now),
    },
    ["status", "reviewedAt", "reviewedByUid", "convertedChoreId", "updatedAt"],
  );

  await writeGhostActivity({
    familyId: input.familyId,
    kind: "ghost_chore_approved",
    actorUid: input.reviewerUid,
    actorEmail: input.reviewerEmail,
    actorName: input.reviewerName,
    title: "Suggested chore approved",
    message: `${input.reviewerName || "An admin"} approved the suggested chore "${title}".`,
    choreId,
    choreTitle: title,
    relatedIds: [record.playerUid, assigneeId].filter(Boolean),
  });

  const source: GhostSuggestionSource = record.source === "athena" ? "athena" : "local";
  const edited =
    (overrides.title !== undefined && overrides.title !== record.suggestedTitle) ||
    (overrides.details !== undefined && overrides.details !== record.suggestedDescription) ||
    (overrides.coinValue !== undefined && overrides.coinValue !== record.suggestedCoinValue) ||
    overrides.categoryIds !== undefined ||
    overrides.dueDate !== undefined ||
    overrides.requireApproval !== undefined;
  if (edited) {
    trackGhostEvent("ghost_suggestion_edited", { familyId: input.familyId, source });
  }
  trackGhostEvent("ghost_suggestion_approved", { familyId: input.familyId, source });

  if (record.source === "athena") {
    await rememberAthenaAcceptance({
      familyId: input.familyId,
      playerId: assigneeId || record.playerMemberId,
      signal: {
        suggestionType: record.athenaSuggestionType || undefined,
        pillar: record.athenaPillar || undefined,
        category: record.athenaCategoryLabel || undefined,
        difficulty: record.athenaDifficulty || undefined,
        title,
      },
    });
  }

  return { ok: true, choreId };
}

/** Admin rejects a requested ghost chore. */
export async function rejectGhostSuggestion(input: {
  familyId: string;
  suggestionId: string;
  reviewerUid: string;
}): Promise<{ ok: true } | { ok: false; error: "not_found" | "invalid_status" }> {
  const record = await getGhostRecord(input.familyId, input.suggestionId);
  if (!record) {
    return { ok: false, error: "not_found" };
  }
  if (record.status !== "requested") {
    return { ok: false, error: "invalid_status" };
  }
  const now = new Date().toISOString();
  await adminPatchDocument(
    `${ghostSuggestionsPath(input.familyId)}/${input.suggestionId}`,
    {
      status: stringField("rejected"),
      reviewedAt: timestampField(now),
      reviewedByUid: stringField(input.reviewerUid),
      updatedAt: timestampField(now),
    },
    ["status", "reviewedAt", "reviewedByUid", "updatedAt"],
  );
  return { ok: true };
}

async function writeGhostActivity(input: {
  familyId: string;
  kind: string;
  actorUid: string;
  actorEmail: string;
  actorName: string;
  title: string;
  message: string;
  choreId?: string;
  choreTitle?: string;
  relatedIds?: string[];
}) {
  const now = new Date().toISOString();
  const relatedIds = Array.from(
    new Set([input.actorUid, input.actorEmail, ...(input.relatedIds ?? [])].map((id) => id.trim().toLowerCase()).filter(Boolean)),
  );
  try {
    await adminCreateOrReplaceDocument(`families/${input.familyId}/notifications/${randomUUID()}`, {
      familyId: stringField(input.familyId),
      kind: stringField(input.kind),
      actorUid: stringField(input.actorUid),
      actorEmail: stringField(input.actorEmail),
      actorName: stringField(input.actorName),
      title: stringField(input.title.slice(0, 180)),
      message: stringField(input.message.slice(0, 600)),
      choreId: stringField(input.choreId ?? ""),
      choreTitle: stringField(input.choreTitle ?? ""),
      relatedIds: stringArrayField(relatedIds),
      createdAt: timestampField(now),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.error("[GHOST_ACTIVITY_ERROR]", reason.slice(0, 180));
  }
}

export async function notifyGhostRequest(input: {
  familyId: string;
  requesterUid: string;
  requesterName: string;
  requesterEmail: string;
  suggestionTitle: string;
}) {
  await writeGhostActivity({
    familyId: input.familyId,
    kind: "ghost_chore_requested",
    actorUid: input.requesterUid,
    actorEmail: input.requesterEmail,
    actorName: input.requesterName,
    title: "Suggested chore requested",
    message: `${input.requesterName || "A player"} requested the suggested chore "${input.suggestionTitle}".`,
    choreTitle: input.suggestionTitle,
  });
}

export type { GhostChoreSuggestion, GhostChoreSuggestionRecord, GhostChoreStatus } from "@/lib/ghost-chores";
