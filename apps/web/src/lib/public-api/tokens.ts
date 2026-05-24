import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  adminCreateDocument,
  adminCreateOrReplaceDocument,
  adminGetDocument,
  adminListDocuments,
  adminPatchDocument,
  adminRunQuery,
} from "@/lib/firestore/admin";
import {
  arrayField,
  boolField,
  documentIdFromName,
  integerField,
  mapField,
  readBoolean,
  readInteger,
  readString,
  readStringArray,
  readTimestamp,
  stringArrayField,
  stringField,
  timestampField,
  type FirestoreDocument,
  type FirestoreValue,
} from "@/lib/firestore/rest";
import {
  PUBLIC_API_DAILY_LIMIT,
  PUBLIC_API_SCOPES,
  type ApiAuditEventType,
  type ApiTokenRecord,
  type PublicApiScope,
} from "@/lib/public-api/types";

const TOKEN_COLLECTION = "apiTokens";
const AUDIT_COLLECTION = "publicApiAudit";

function tokenHashSecret() {
  const secret = process.env.API_TOKEN_HASH_SECRET || process.env.SESSION_SECRET || "";
  if (secret.length < 32) {
    throw new Error("API_TOKEN_HASH_SECRET_OR_SESSION_SECRET_REQUIRED");
  }
  return secret;
}

function hashToken(token: string) {
  return createHash("sha256").update(`${tokenHashSecret()}:${token}`).digest("hex");
}

function utcDay(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function currentRateLimitResetIso(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)).toISOString();
}

function readToken(doc: FirestoreDocument): ApiTokenRecord {
  return {
    id: documentIdFromName(doc.name),
    userId: readString(doc.fields, "userId"),
    familyId: readString(doc.fields, "familyId"),
    tokenPrefix: readString(doc.fields, "tokenPrefix"),
    tokenHash: readString(doc.fields, "tokenHash"),
    name: readString(doc.fields, "name"),
    status: (readString(doc.fields, "status") || "disabled") as ApiTokenRecord["status"],
    scopes: readStringArray(doc.fields, "scopes").filter(isPublicApiScope),
    createdAt: readTimestamp(doc.fields, "createdAt"),
    updatedAt: readTimestamp(doc.fields, "updatedAt"),
    lastUsedAt: readTimestamp(doc.fields, "lastUsedAt"),
    disabledAt: readTimestamp(doc.fields, "disabledAt"),
    deletedAt: readTimestamp(doc.fields, "deletedAt"),
    regeneratedAt: readTimestamp(doc.fields, "regeneratedAt"),
    expiresAt: readTimestamp(doc.fields, "expiresAt"),
    createdIp: readString(doc.fields, "createdIp"),
    lastUsedIp: readString(doc.fields, "lastUsedIp"),
    usageDay: readString(doc.fields, "usageDay"),
    usageCountToday: readInteger(doc.fields, "usageCountToday"),
    lastUsedEndpoint: readString(doc.fields, "lastUsedEndpoint"),
    lastErrorAt: readTimestamp(doc.fields, "lastErrorAt"),
    lastErrorCode: readString(doc.fields, "lastErrorCode"),
  };
}

function isPublicApiScope(value: string): value is PublicApiScope {
  return PUBLIC_API_SCOPES.includes(value as PublicApiScope);
}

export function normalizeScopes(values: unknown): PublicApiScope[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return Array.from(new Set(values.filter((value): value is string => typeof value === "string")))
    .filter(isPublicApiScope)
    .sort();
}

function createRawToken() {
  const visible = randomBytes(4).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  return {
    token: `fc_live_${visible}_${secret}`,
    tokenPrefix: `fc_live_${visible}`,
  };
}

function safeCompareHash(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function getClientIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwardedFor || request.headers.get("x-real-ip") || "";
}

export async function resolveUserFamilyForApiToken(input: {
  uid: string;
  email: string;
}) {
  let familyId = "";
  let familyName = "My Family";
  try {
    const userDoc = await adminGetDocument(`users/${input.uid}`);
    familyId = readStringArray(userDoc.fields, "familyIds")[0] ?? "";
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (!reason.includes("FIRESTORE_ADMIN_HTTP_404")) {
      throw error;
    }
  }

  const memberDocs = familyId
    ? await adminListDocuments(`families/${familyId}/members`, 200)
    : await adminRunQuery({
        from: [{ collectionId: "members", allDescendants: true }],
        where: {
          fieldFilter: {
            field: { fieldPath: "uid" },
            op: "EQUAL",
            value: { stringValue: input.uid },
          },
        },
        limit: 10,
      });

  if (!familyId) {
    const memberDoc = memberDocs.find((doc) => !readBoolean(doc.fields, "deleted"));
    const match = memberDoc?.name.match(/\/families\/([^/]+)\/members\//);
    familyId = match?.[1] ?? "";
  }

  let viewerRole: "admin" | "player" = "player";
  let viewerMemberId = input.uid;
  if (familyId) {
    try {
      const familyDoc = await adminGetDocument(`families/${familyId}`);
      familyName = readString(familyDoc.fields, "name") || familyName;
    } catch {
      familyName = "My Family";
    }
    const members = memberDocs.length ? memberDocs : await adminListDocuments(`families/${familyId}/members`, 200);
    const normalizedEmail = input.email.trim().toLowerCase();
    const viewerMember = members.find((doc) => {
      if (readBoolean(doc.fields, "deleted")) {
        return false;
      }
      return (
        documentIdFromName(doc.name) === input.uid ||
        readString(doc.fields, "uid") === input.uid ||
        (normalizedEmail && readString(doc.fields, "email").trim().toLowerCase() === normalizedEmail)
      );
    });
    if (viewerMember) {
      viewerMemberId = documentIdFromName(viewerMember.name);
      viewerRole = readString(viewerMember.fields, "role") === "admin" ? "admin" : "player";
    }
  }

  return { familyId, familyName, viewerRole, viewerMemberId };
}

export async function listApiTokensForUser(userId: string) {
  const docs = await adminListDocuments(TOKEN_COLLECTION, 200);
  return docs
    .map(readToken)
    .filter((token) => token.userId === userId)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

export async function getTokenByIdForUser(tokenId: string, userId: string) {
  const doc = await adminGetDocument(`${TOKEN_COLLECTION}/${tokenId}`);
  const token = readToken(doc);
  return token.userId === userId ? token : null;
}

export async function createApiToken(input: {
  userId: string;
  familyId: string;
  name: string;
  scopes: PublicApiScope[];
  ipAddress: string;
  userAgent: string;
}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const raw = createRawToken();
  const fields = tokenFields({
    id,
    userId: input.userId,
    familyId: input.familyId,
    tokenPrefix: raw.tokenPrefix,
    tokenHash: hashToken(raw.token),
    name: input.name,
    status: "active",
    scopes: input.scopes,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: "",
    disabledAt: "",
    deletedAt: "",
    regeneratedAt: "",
    expiresAt: "",
    createdIp: input.ipAddress,
    lastUsedIp: "",
    usageDay: utcDay(),
    usageCountToday: 0,
    lastUsedEndpoint: "",
    lastErrorAt: "",
    lastErrorCode: "",
  });
  await adminCreateDocument(TOKEN_COLLECTION, id, fields);
  await recordApiAudit({
    eventType: "token.created",
    userId: input.userId,
    familyId: input.familyId,
    apiTokenId: id,
    endpoint: "/api/profile/api-tokens",
    method: "POST",
    statusCode: 201,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    requestId: "",
    metadata: { scopes: input.scopes, tokenPrefix: raw.tokenPrefix },
  });
  return { token: readToken({ name: `${TOKEN_COLLECTION}/${id}`, fields }), rawToken: raw.token };
}

export async function updateApiTokenStatus(input: {
  token: ApiTokenRecord;
  action: "disable" | "delete";
  ipAddress: string;
  userAgent: string;
}) {
  const now = new Date().toISOString();
  const fields: Record<string, FirestoreValue> = {
    status: stringField(input.action === "disable" ? "disabled" : "deleted"),
    updatedAt: timestampField(now),
  };
  const mask = ["status", "updatedAt"];
  if (input.action === "disable") {
    fields.disabledAt = timestampField(now);
    mask.push("disabledAt");
  } else {
    fields.deletedAt = timestampField(now);
    mask.push("deletedAt");
  }
  await adminPatchDocument(`${TOKEN_COLLECTION}/${input.token.id}`, fields, mask);
  await recordApiAudit({
    eventType: input.action === "disable" ? "token.disabled" : "token.deleted",
    userId: input.token.userId,
    familyId: input.token.familyId,
    apiTokenId: input.token.id,
    endpoint: `/api/profile/api-tokens/${input.token.id}`,
    method: "PATCH",
    statusCode: 200,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    requestId: "",
    metadata: {},
  });
}

export async function regenerateApiToken(input: {
  token: ApiTokenRecord;
  ipAddress: string;
  userAgent: string;
}) {
  const raw = createRawToken();
  const now = new Date().toISOString();
  await adminPatchDocument(
    `${TOKEN_COLLECTION}/${input.token.id}`,
    {
      tokenPrefix: stringField(raw.tokenPrefix),
      tokenHash: stringField(hashToken(raw.token)),
      status: stringField("active"),
      updatedAt: timestampField(now),
      regeneratedAt: timestampField(now),
      disabledAt: stringField(""),
      deletedAt: stringField(""),
      usageDay: stringField(utcDay()),
      usageCountToday: integerField(0),
    },
    [
      "tokenPrefix",
      "tokenHash",
      "status",
      "updatedAt",
      "regeneratedAt",
      "disabledAt",
      "deletedAt",
      "usageDay",
      "usageCountToday",
    ],
  );
  await recordApiAudit({
    eventType: "token.regenerated",
    userId: input.token.userId,
    familyId: input.token.familyId,
    apiTokenId: input.token.id,
    endpoint: `/api/profile/api-tokens/${input.token.id}`,
    method: "PATCH",
    statusCode: 200,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    requestId: "",
    metadata: { tokenPrefix: raw.tokenPrefix },
  });
  return raw.token;
}

export async function authenticateApiToken(rawToken: string) {
  const parts = rawToken.split("_");
  if (parts.length < 4 || parts[0] !== "fc" || parts[1] !== "live") {
    return null;
  }
  const tokenPrefix = parts.slice(0, 3).join("_");
  const docs = await adminRunQuery({
    from: [{ collectionId: TOKEN_COLLECTION }],
    where: {
      fieldFilter: {
        field: { fieldPath: "tokenPrefix" },
        op: "EQUAL",
        value: { stringValue: tokenPrefix },
      },
    },
    limit: 10,
  });
  const rawHash = hashToken(rawToken);
  for (const doc of docs) {
    const token = readToken(doc);
    if (safeCompareHash(rawHash, token.tokenHash)) {
      return token;
    }
  }
  return null;
}

export async function incrementTokenUsage(input: {
  token: ApiTokenRecord;
  endpoint: string;
  ipAddress: string;
}) {
  const today = utcDay();
  const used = input.token.usageDay === today ? input.token.usageCountToday : 0;
  const nextUsed = used + 1;
  const now = new Date().toISOString();
  await adminPatchDocument(
    `${TOKEN_COLLECTION}/${input.token.id}`,
    {
      usageDay: stringField(today),
      usageCountToday: integerField(nextUsed),
      lastUsedAt: timestampField(now),
      lastUsedIp: stringField(input.ipAddress),
      lastUsedEndpoint: stringField(input.endpoint),
      updatedAt: timestampField(now),
    },
    ["usageDay", "usageCountToday", "lastUsedAt", "lastUsedIp", "lastUsedEndpoint", "updatedAt"],
  );
  return {
    used: nextUsed,
    remaining: Math.max(0, PUBLIC_API_DAILY_LIMIT - nextUsed),
    resetAt: currentRateLimitResetIso(),
  };
}

export async function markTokenError(input: {
  token: ApiTokenRecord;
  code: string;
}) {
  await adminPatchDocument(
    `${TOKEN_COLLECTION}/${input.token.id}`,
    {
      lastErrorAt: timestampField(new Date().toISOString()),
      lastErrorCode: stringField(input.code),
      updatedAt: timestampField(new Date().toISOString()),
    },
    ["lastErrorAt", "lastErrorCode", "updatedAt"],
  );
}

export async function recordApiAudit(input: {
  eventType: ApiAuditEventType;
  userId?: string;
  familyId?: string;
  apiTokenId?: string;
  endpoint: string;
  method: string;
  statusCode: number;
  ipAddress: string;
  userAgent: string;
  requestId: string;
  metadata?: Record<string, unknown>;
}) {
  const id = randomUUID();
  await adminCreateOrReplaceDocument(`${AUDIT_COLLECTION}/${id}`, {
    id: stringField(id),
    userId: stringField(input.userId ?? ""),
    familyId: stringField(input.familyId ?? ""),
    apiTokenId: stringField(input.apiTokenId ?? ""),
    eventType: stringField(input.eventType),
    endpoint: stringField(input.endpoint),
    method: stringField(input.method),
    statusCode: integerField(input.statusCode),
    ipAddress: stringField(input.ipAddress),
    userAgent: stringField(input.userAgent.slice(0, 500)),
    requestId: stringField(input.requestId),
    metadata: toMapField(input.metadata ?? {}),
    createdAt: timestampField(new Date().toISOString()),
  });
}

export async function listApiAuditForUser(userId: string, limit = 20) {
  const docs = await adminListDocuments(AUDIT_COLLECTION, 300);
  return docs
    .filter((doc) => readString(doc.fields, "userId") === userId)
    .map((doc) => ({
      id: documentIdFromName(doc.name),
      eventType: readString(doc.fields, "eventType"),
      endpoint: readString(doc.fields, "endpoint"),
      method: readString(doc.fields, "method"),
      statusCode: readInteger(doc.fields, "statusCode"),
      requestId: readString(doc.fields, "requestId"),
      createdAt: readTimestamp(doc.fields, "createdAt"),
    }))
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, Math.max(1, limit));
}

export function serializeApiToken(token: ApiTokenRecord) {
  const usedToday = token.usageDay === utcDay() ? token.usageCountToday : 0;
  return {
    id: token.id,
    name: token.name,
    status: token.status,
    tokenPrefix: `${token.tokenPrefix}...`,
    scopes: token.scopes,
    createdAt: token.createdAt,
    updatedAt: token.updatedAt,
    lastUsedAt: token.lastUsedAt || null,
    disabledAt: token.disabledAt || null,
    deletedAt: token.deletedAt || null,
    regeneratedAt: token.regeneratedAt || null,
    expiresAt: token.expiresAt || null,
    lastUsedEndpoint: token.lastUsedEndpoint || null,
    lastErrorAt: token.lastErrorAt || null,
    lastErrorCode: token.lastErrorCode || null,
    usage: {
      usedToday,
      remainingToday: Math.max(0, PUBLIC_API_DAILY_LIMIT - usedToday),
      limit: PUBLIC_API_DAILY_LIMIT,
      resetAt: currentRateLimitResetIso(),
    },
  };
}

function tokenFields(token: ApiTokenRecord): Record<string, FirestoreValue> {
  return {
    id: stringField(token.id),
    userId: stringField(token.userId),
    familyId: stringField(token.familyId),
    tokenPrefix: stringField(token.tokenPrefix),
    tokenHash: stringField(token.tokenHash),
    name: stringField(token.name),
    status: stringField(token.status),
    scopes: stringArrayField(token.scopes),
    createdAt: timestampField(token.createdAt),
    updatedAt: timestampField(token.updatedAt),
    lastUsedAt: token.lastUsedAt ? timestampField(token.lastUsedAt) : stringField(""),
    disabledAt: token.disabledAt ? timestampField(token.disabledAt) : stringField(""),
    deletedAt: token.deletedAt ? timestampField(token.deletedAt) : stringField(""),
    regeneratedAt: token.regeneratedAt ? timestampField(token.regeneratedAt) : stringField(""),
    expiresAt: token.expiresAt ? timestampField(token.expiresAt) : stringField(""),
    createdIp: stringField(token.createdIp),
    lastUsedIp: stringField(token.lastUsedIp),
    usageDay: stringField(token.usageDay),
    usageCountToday: integerField(token.usageCountToday),
    lastUsedEndpoint: stringField(token.lastUsedEndpoint),
    lastErrorAt: token.lastErrorAt ? timestampField(token.lastErrorAt) : stringField(""),
    lastErrorCode: stringField(token.lastErrorCode),
  };
}

function toMapField(value: Record<string, unknown>): FirestoreValue {
  const fields: Record<string, FirestoreValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") {
      fields[key] = stringField(entry);
    } else if (typeof entry === "number") {
      fields[key] = integerField(entry);
    } else if (typeof entry === "boolean") {
      fields[key] = boolField(entry);
    } else if (Array.isArray(entry)) {
      fields[key] = arrayField(entry.map((item) => stringField(String(item))));
    } else if (entry && typeof entry === "object") {
      fields[key] = mapField({});
    } else {
      fields[key] = stringField("");
    }
  }
  return mapField(fields);
}
