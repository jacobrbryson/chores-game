import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { FirestoreDocument, FirestoreValue } from "@/lib/firestore/rest";

type ServiceAccount = {
  client_email?: string;
  private_key?: string;
  project_id?: string;
};

type FirestoreRunQueryResult = {
  document?: FirestoreDocument;
};

export type AdminCommitWrite =
  | {
      update: {
        path: string;
        fields: Record<string, FirestoreValue>;
        updateMask?: string[];
        currentDocument?: {
          exists?: boolean;
          updateTime?: string;
        };
      };
    }
  | {
      delete: {
        path: string;
        currentDocument?: {
          exists?: boolean;
          updateTime?: string;
        };
      };
    }
  | {
      transform: {
        path: string;
        fieldTransforms: Array<{
          fieldPath: string;
          increment: FirestoreValue;
        }>;
      };
    };

let cachedToken: { token: string; expiresAtMillis: number } | null = null;

function getProjectId() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
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

function encodeBase64Url(input: string) {
  return Buffer.from(input).toString("base64url");
}

async function readServiceAccount() {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim();
  if (rawJson) {
    return JSON.parse(rawJson) as ServiceAccount;
  }

  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (credentialsPath) {
    return JSON.parse(await readFile(credentialsPath, "utf8")) as ServiceAccount;
  }

  return null;
}

async function fetchMetadataToken() {
  const response = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    {
      headers: { "Metadata-Flavor": "Google" },
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new Error(`METADATA_TOKEN_HTTP_${response.status}`);
  }
  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!payload.access_token) {
    throw new Error("METADATA_TOKEN_MISSING");
  }
  return {
    token: payload.access_token,
    expiresAtMillis: Date.now() + Math.max(60, payload.expires_in ?? 300) * 1000,
  };
}

async function fetchServiceAccountToken(account: ServiceAccount) {
  if (!account.client_email || !account.private_key) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY_INVALID");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const assertionHeader = encodeBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const assertionPayload = encodeBase64Url(
    JSON.stringify({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/datastore",
      aud: "https://oauth2.googleapis.com/token",
      exp: nowSeconds + 3600,
      iat: nowSeconds,
    }),
  );
  const unsignedJwt = `${assertionHeader}.${assertionPayload}`;
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
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`SERVICE_ACCOUNT_TOKEN_HTTP_${response.status}`);
  }
  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!payload.access_token) {
    throw new Error("SERVICE_ACCOUNT_TOKEN_MISSING");
  }
  return {
    token: payload.access_token,
    expiresAtMillis: Date.now() + Math.max(60, payload.expires_in ?? 3600) * 1000,
  };
}

async function getAdminAccessToken() {
  if (cachedToken && cachedToken.expiresAtMillis - Date.now() > 60_000) {
    return cachedToken.token;
  }

  const serviceAccount = await readServiceAccount();
  try {
    cachedToken = serviceAccount
      ? await fetchServiceAccountToken(serviceAccount)
      : await fetchMetadataToken();
  } catch (error) {
    // No explicit service account configured means we fell back to the GCP
    // metadata server, which only exists on deployed App Hosting. Locally that
    // surfaces as an opaque "fetch failed" — give operators an actionable hint.
    if (!serviceAccount) {
      throw new Error(
        "ADMIN_CREDENTIALS_UNAVAILABLE: no service account found. Set FIREBASE_SERVICE_ACCOUNT_KEY or GOOGLE_APPLICATION_CREDENTIALS in apps/web/.env.local and restart the dev server (env files load at startup). The GCP metadata server is only available when deployed.",
      );
    }
    throw error;
  }
  return cachedToken.token;
}

async function requestFirestoreAdmin<T>(url: string, init?: RequestInit) {
  const token = await getAdminAccessToken();
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    let detail = raw;
    try {
      const json = JSON.parse(raw) as { error?: { message?: string } };
      detail = json.error?.message ?? raw;
    } catch {
      // Preserve the raw response when the API does not return JSON.
    }
    throw new Error(`FIRESTORE_ADMIN_HTTP_${response.status}${detail ? `_${detail}` : ""}`);
  }

  return (await response.json()) as T;
}

function toAdminDocumentName(path: string) {
  return `projects/${getProjectId()}/databases/(default)/documents/${path}`;
}

export async function adminListDocuments(path: string, pageSize = 100) {
  const response = await requestFirestoreAdmin<{ documents?: FirestoreDocument[] }>(
    `${baseDocumentsUrl()}/${path}?pageSize=${pageSize}`,
  );
  return response.documents ?? [];
}

// Firestore REST caps documents.list pageSize at 300 and a single call never
// returns more than one page, so adminListDocuments silently drops anything
// beyond that. adminListAllDocuments follows nextPageToken until the collection
// is exhausted (or the safety cap is hit) so callers can read an entire
// collection — important for unbounded ones like chores (recurring chores spawn
// a new doc each cycle) and walletLedger.
export async function adminListAllDocuments(
  path: string,
  options?: { cap?: number; pageSize?: number },
) {
  const cap = options?.cap ?? 5000;
  const pageSize = Math.min(300, Math.max(1, options?.pageSize ?? 300));
  const documents: FirestoreDocument[] = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({ pageSize: String(pageSize) });
    if (pageToken) {
      params.set("pageToken", pageToken);
    }
    const response = await requestFirestoreAdmin<{
      documents?: FirestoreDocument[];
      nextPageToken?: string;
    }>(`${baseDocumentsUrl()}/${path}?${params.toString()}`);
    for (const doc of response.documents ?? []) {
      documents.push(doc);
      if (documents.length >= cap) {
        return documents;
      }
    }
    pageToken = response.nextPageToken ?? "";
  } while (pageToken);
  return documents;
}

// Lists the child collection ids under a document, or under the database root
// when `parentPath` is omitted. Read-only. Used by the email-keying migration
// dry run to discover which collections exist instead of trusting a
// hand-maintained list. Pages through nextPageToken so the answer is complete.
export async function adminListCollectionIds(parentPath = "") {
  const url = parentPath
    ? `${baseDocumentsUrl()}/${parentPath}:listCollectionIds`
    : `${baseDocumentsUrl()}:listCollectionIds`;
  const collectionIds: string[] = [];
  let pageToken = "";
  do {
    const response = await requestFirestoreAdmin<{
      collectionIds?: string[];
      nextPageToken?: string;
    }>(url, {
      method: "POST",
      body: JSON.stringify({ pageSize: 100, ...(pageToken ? { pageToken } : {}) }),
    });
    collectionIds.push(...(response.collectionIds ?? []));
    pageToken = response.nextPageToken ?? "";
  } while (pageToken);
  return collectionIds;
}

export async function adminGetDocument(path: string) {
  return requestFirestoreAdmin<FirestoreDocument>(`${baseDocumentsUrl()}/${path}`);
}

export async function adminRunQuery(structuredQuery: Record<string, unknown>) {
  const rows = await requestFirestoreAdmin<FirestoreRunQueryResult[]>(
    `${baseDatabaseUrl()}/documents:runQuery`,
    {
      method: "POST",
      body: JSON.stringify({ structuredQuery }),
    },
  );
  return rows.map((row) => row.document).filter((doc): doc is FirestoreDocument => Boolean(doc));
}

// Runs a structured query relative to a concrete document path. This is useful
// for securely reading another family's child collection after a server-side
// relationship check, without widening client Firestore rules.
export async function adminRunQueryAt(
  parentPath: string,
  structuredQuery: Record<string, unknown>,
) {
  const rows = await requestFirestoreAdmin<FirestoreRunQueryResult[]>(
    `${baseDocumentsUrl()}/${parentPath}:runQuery`,
    {
      method: "POST",
      body: JSON.stringify({ structuredQuery }),
    },
  );
  return rows.map((row) => row.document).filter((doc): doc is FirestoreDocument => Boolean(doc));
}

// adminRunQuery returns whatever a single runQuery streams back, which is fine
// for capped browse views but not for aggregating an entire collection group.
// adminRunQueryAllInCollectionGroup pages through the whole group by ordering on
// __name__ and cursoring past the last document, so callers can count/aggregate
// every doc (e.g. total chores across all families). Returns `truncated: true`
// if the safety cap is hit before the group is exhausted.
export async function adminRunQueryAllInCollectionGroup(
  collectionId: string,
  options?: { cap?: number; pageSize?: number },
): Promise<{ documents: FirestoreDocument[]; truncated: boolean }> {
  const cap = options?.cap ?? 20000;
  const pageSize = Math.min(1000, Math.max(1, options?.pageSize ?? 1000));
  const documents: FirestoreDocument[] = [];
  let cursor: string | null = null;

  for (;;) {
    const structuredQuery: Record<string, unknown> = {
      from: [{ collectionId, allDescendants: true }],
      orderBy: [{ field: { fieldPath: "__name__" }, direction: "ASCENDING" }],
      limit: pageSize,
    };
    if (cursor) {
      structuredQuery.startAt = {
        before: false,
        values: [{ referenceValue: cursor }],
      };
    }

    const page = await adminRunQuery(structuredQuery);
    if (page.length === 0) {
      break;
    }
    for (const doc of page) {
      documents.push(doc);
      if (documents.length >= cap) {
        return { documents, truncated: true };
      }
    }
    if (page.length < pageSize) {
      break;
    }
    cursor = page[page.length - 1]?.name ?? null;
    if (!cursor) {
      break;
    }
  }

  return { documents, truncated: false };
}

export async function adminCreateDocument(
  path: string,
  documentId: string,
  fields: Record<string, FirestoreValue>,
) {
  return requestFirestoreAdmin<FirestoreDocument>(
    `${baseDocumentsUrl()}/${path}?documentId=${encodeURIComponent(documentId)}`,
    {
      method: "POST",
      body: JSON.stringify({ fields }),
    },
  );
}

export async function adminPatchDocument(
  path: string,
  fields: Record<string, FirestoreValue>,
  updateMask: string[] = [],
) {
  const query =
    updateMask.length === 0
      ? ""
      : `?${updateMask
          .map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`)
          .join("&")}`;

  return requestFirestoreAdmin<FirestoreDocument>(`${baseDocumentsUrl()}/${path}${query}`, {
    method: "PATCH",
    body: JSON.stringify({ fields }),
  });
}

export async function adminDeleteDocument(path: string) {
  const token = await getAdminAccessToken();
  const response = await fetch(`${baseDocumentsUrl()}/${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) {
    let detail = "";
    try {
      const json = (await response.json()) as { error?: { message?: string } };
      detail = json.error?.message ?? "";
    } catch {
      detail = await response.text();
    }
    throw new Error(`FIRESTORE_ADMIN_HTTP_${response.status}${detail ? `_${detail}` : ""}`);
  }
}

export async function adminCreateOrReplaceDocument(
  path: string,
  fields: Record<string, FirestoreValue>,
) {
  return requestFirestoreAdmin<FirestoreDocument>(`${baseDocumentsUrl()}/${path}`, {
    method: "PATCH",
    body: JSON.stringify({ fields }),
  });
}

export async function adminCommitWrites(writes: AdminCommitWrite[]) {
  return requestFirestoreAdmin<{ writeResults?: Array<{ updateTime?: string }> }>(
    `${baseDatabaseUrl()}/documents:commit`,
    {
      method: "POST",
      body: JSON.stringify({
        writes: writes.map((write) => {
          if ("delete" in write) {
            return {
              delete: toAdminDocumentName(write.delete.path),
              currentDocument: write.delete.currentDocument,
            };
          }
          if ("transform" in write) {
            return {
              transform: {
                document: toAdminDocumentName(write.transform.path),
                fieldTransforms: write.transform.fieldTransforms,
              },
            };
          }
          return {
            update: {
              name: toAdminDocumentName(write.update.path),
              fields: write.update.fields,
            },
            updateMask: write.update.updateMask
              ? { fieldPaths: write.update.updateMask }
              : undefined,
            currentDocument: write.update.currentDocument,
          };
        }),
      }),
    },
  );
}
