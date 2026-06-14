#!/usr/bin/env node
import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";

const METRICS_DOC_PATH = "appConfig/supportDashboardMetrics";
const DAY_MILLIS = 24 * 60 * 60 * 1000;

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
      count: 0,
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

async function main() {
  const token = await getAdminAccessToken();
  const series = buildLast30DaysSeries();
  const bucketByKey = new Map(series.map((entry) => [entry.key, entry]));
  const windowStart = new Date(`${series[0].key}T00:00:00.000Z`).toISOString();
  const windowEnd = new Date(`${series[series.length - 1].key}T23:59:59.999Z`).toISOString();

  const rows = await firestoreAdminRequest(`${baseDatabaseUrl()}/documents:runQuery`, token, {
    method: "POST",
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "auditLogs", allDescendants: true }],
        where: {
          fieldFilter: {
            field: { fieldPath: "createdAt" },
            op: "GREATER_THAN_OR_EQUAL",
            value: { timestampValue: windowStart },
          },
        },
        orderBy: [{ field: { fieldPath: "createdAt" }, direction: "ASCENDING" }],
      },
    }),
  });

  for (const row of rows) {
    const fields = row?.document?.fields;
    const key = dateKeyFromIso(readString(fields, "createdAt"));
    const bucket = bucketByKey.get(key);
    if (bucket) {
      bucket.count += 1;
    }
  }

  const audit30DayTotal = series.reduce((sum, entry) => sum + entry.count, 0);
  const now = new Date().toISOString();
  const fields = {
    audit30DayTotal: { integerValue: String(audit30DayTotal) },
    audit30DaySeriesJson: { stringValue: JSON.stringify(series.map(({ key, count }) => ({ date: key, count }))) },
    audit30DayWindowStart: { stringValue: series[0].key },
    audit30DayWindowEnd: { stringValue: series[series.length - 1].key },
    updatedAt: { timestampValue: now },
  };

  await firestoreAdminRequest(`${baseDocumentsUrl()}/${METRICS_DOC_PATH}`, token, {
    method: "PATCH",
    body: JSON.stringify({ fields }),
  });

  console.log(`Updated ${METRICS_DOC_PATH}`);
  console.log(`Window: ${series[0].key} -> ${series[series.length - 1].key}`);
  console.log(`30-day audit total: ${audit30DayTotal}`);
}

main().catch((error) => {
  console.error("[REBUILD_SUPPORT_AUDIT_METRICS_ERROR]", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
