#!/usr/bin/env node
import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";

const METRICS_DOC_PATH = "appConfig/supportDashboardMetrics";

function getProjectId() {
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  if (!projectId) {
    throw new Error("FIREBASE_PROJECT_ID_MISSING");
  }
  return projectId;
}

function baseDocumentsUrl() {
  return `https://firestore.googleapis.com/v1/projects/${getProjectId()}/databases/(default)/documents`;
}

function baseDatabaseUrl() {
  return `https://firestore.googleapis.com/v1/projects/${getProjectId()}/databases/(default)`;
}

function encodeBase64Url(input) {
  return Buffer.from(input).toString("base64url");
}

async function readServiceAccount() {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim();
  if (rawJson) {
    return JSON.parse(rawJson);
  }
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (credentialsPath) {
    return JSON.parse(await readFile(credentialsPath, "utf8"));
  }
  throw new Error("ADMIN_CREDENTIALS_UNAVAILABLE");
}

async function getAdminAccessToken() {
  const account = await readServiceAccount();
  if (!account.client_email || !account.private_key) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY_INVALID");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const unsignedJwt = [
    encodeBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" })),
    encodeBase64Url(
      JSON.stringify({
        iss: account.client_email,
        scope: "https://www.googleapis.com/auth/datastore",
        aud: "https://oauth2.googleapis.com/token",
        exp: nowSeconds + 3600,
        iat: nowSeconds,
      }),
    ),
  ].join(".");

  const signer = createSign("RSA-SHA256");
  signer.update(unsignedJwt);
  signer.end();
  const signature = signer.sign(account.private_key).toString("base64url");

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsignedJwt}.${signature}`,
    }),
  });
  if (!response.ok) {
    throw new Error(`SERVICE_ACCOUNT_TOKEN_HTTP_${response.status}`);
  }
  const payload = await response.json();
  if (!payload.access_token) {
    throw new Error("SERVICE_ACCOUNT_TOKEN_MISSING");
  }
  return payload.access_token;
}

async function firestoreAdminRequest(url, token, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`FIRESTORE_ADMIN_HTTP_${response.status}_${text.slice(0, 240)}`);
  }
  return response.json();
}

function readString(fields, key) {
  const value = fields?.[key];
  if (!value) return "";
  if ("stringValue" in value) return value.stringValue;
  if ("timestampValue" in value) return value.timestampValue;
  return "";
}

function buildLast30DaysSeries() {
  const today = new Date();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Array.from({ length: 30 }, (_, index) => {
    const date = new Date(end);
    date.setDate(end.getDate() - (29 - index));
    return {
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
      newFamilies: 0,
      newUsers: 0,
      choresCreated: 0,
      routinesCreated: 0,
      choresCompleted: 0,
      routinesCompleted: 0,
    };
  });
}

function dateKeyFromIso(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}

// Top-level collections can filter server-side on a single field using
// Firestore's automatic indexes. Collection-group queries with a field filter
// would require COLLECTION_GROUP index exemptions, so those collections are
// scanned unfiltered (paginated by __name__) and bucketed client-side instead
// — one source may feed multiple series (e.g. chores -> created + completed).
const FILTERED_SOURCES = [
  { collectionId: "families", fields: [{ seriesKey: "newFamilies", timestampField: "createdAt" }] },
  { collectionId: "users", fields: [{ seriesKey: "newUsers", timestampField: "createdAt" }] },
];

const SCANNED_SOURCES = [
  {
    collectionId: "chores",
    fields: [
      { seriesKey: "choresCreated", timestampField: "createdAt" },
      { seriesKey: "choresCompleted", timestampField: "submittedAt" },
    ],
  },
  { collectionId: "routines", fields: [{ seriesKey: "routinesCreated", timestampField: "createdAt" }] },
  {
    collectionId: "routineAssignments",
    fields: [{ seriesKey: "routinesCompleted", timestampField: "completedAt" }],
  },
];

const SCAN_PAGE_SIZE = 1000;
const SCAN_MAX_PAGES = 100;

function bucketRows(rows, source, bucketByKey) {
  for (const row of rows) {
    const fields = row?.document?.fields;
    if (!fields) continue;
    for (const metric of source.fields) {
      const key = dateKeyFromIso(readString(fields, metric.timestampField));
      const bucket = bucketByKey.get(key);
      if (bucket) {
        bucket[metric.seriesKey] += 1;
      }
    }
  }
}

async function runFilteredSource(source, token, bucketByKey, windowStart) {
  for (const metric of source.fields) {
    const rows = await firestoreAdminRequest(`${baseDatabaseUrl()}/documents:runQuery`, token, {
      method: "POST",
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: source.collectionId, allDescendants: false }],
          where: {
            fieldFilter: {
              field: { fieldPath: metric.timestampField },
              op: "GREATER_THAN_OR_EQUAL",
              value: { timestampValue: windowStart },
            },
          },
          orderBy: [{ field: { fieldPath: metric.timestampField }, direction: "ASCENDING" }],
        },
      }),
    });
    bucketRows(rows, { fields: [metric] }, bucketByKey);
  }
}

async function runScannedSource(source, token, bucketByKey) {
  let cursorName = "";
  for (let page = 0; page < SCAN_MAX_PAGES; page += 1) {
    const structuredQuery = {
      from: [{ collectionId: source.collectionId, allDescendants: true }],
      orderBy: [{ field: { fieldPath: "__name__" }, direction: "ASCENDING" }],
      limit: SCAN_PAGE_SIZE,
      ...(cursorName
        ? { startAt: { values: [{ referenceValue: cursorName }], before: false } }
        : {}),
    };
    const rows = await firestoreAdminRequest(`${baseDatabaseUrl()}/documents:runQuery`, token, {
      method: "POST",
      body: JSON.stringify({ structuredQuery }),
    });
    const documentRows = rows.filter((row) => row?.document?.name);
    bucketRows(documentRows, source, bucketByKey);
    if (documentRows.length < SCAN_PAGE_SIZE) {
      return;
    }
    cursorName = documentRows[documentRows.length - 1].document.name;
  }
  console.warn(`[SCAN_CAP_REACHED] ${source.collectionId}: stopped after ${SCAN_MAX_PAGES * SCAN_PAGE_SIZE} docs`);
}

async function main() {
  const token = await getAdminAccessToken();
  const series = buildLast30DaysSeries();
  const bucketByKey = new Map(series.map((entry) => [entry.key, entry]));
  const windowStart = new Date(`${series[0].key}T00:00:00.000Z`).toISOString();

  await Promise.all([
    ...FILTERED_SOURCES.map((source) => runFilteredSource(source, token, bucketByKey, windowStart)),
    ...SCANNED_SOURCES.map((source) => runScannedSource(source, token, bucketByKey)),
  ]);

  const now = new Date().toISOString();
  const fields = {
    familyActivity30DaySeriesJson: {
      stringValue: JSON.stringify(
        series.map(({ key, ...counts }) => ({ date: key, ...counts })),
      ),
    },
    familyActivity30DayWindowStart: { stringValue: series[0].key },
    familyActivity30DayWindowEnd: { stringValue: series[series.length - 1].key },
    updatedAt: { timestampValue: now },
  };

  await firestoreAdminRequest(`${baseDocumentsUrl()}/${METRICS_DOC_PATH}`, token, {
    method: "PATCH",
    body: JSON.stringify({ fields }),
  });

  const seriesKeys = [...FILTERED_SOURCES, ...SCANNED_SOURCES].flatMap((source) =>
    source.fields.map((metric) => metric.seriesKey),
  );
  const totals = Object.fromEntries(
    seriesKeys.map((seriesKey) => [
      seriesKey,
      series.reduce((sum, entry) => sum + entry[seriesKey], 0),
    ]),
  );

  console.log(`Updated ${METRICS_DOC_PATH}`);
  console.log(`Window: ${series[0].key} -> ${series[series.length - 1].key}`);
  console.log(`30-day totals: ${JSON.stringify(totals)}`);
}

main().catch((error) => {
  console.error("[REBUILD_SUPPORT_FAMILY_ACTIVITY_METRICS_ERROR]", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
