type FirestorePrimitive =
  | { stringValue: string }
  | { integerValue: string }
  | { timestampValue: string }
  | { booleanValue: boolean }
  | { nullValue: null };

type FirestoreArray = { arrayValue: { values?: FirestoreValue[] } };

type FirestoreMap = { mapValue: { fields?: Record<string, FirestoreValue> } };

export type FirestoreValue = FirestorePrimitive | FirestoreArray | FirestoreMap;

export type FirestoreDocument = {
  name: string;
  fields?: Record<string, FirestoreValue>;
  createTime?: string;
  updateTime?: string;
};

type FirestoreRunQueryResult = {
  document?: FirestoreDocument;
};

function getProjectId() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    throw new Error("FIREBASE_PROJECT_ID_MISSING");
  }
  return projectId;
}

function getBasePath() {
  return `https://firestore.googleapis.com/v1/projects/${getProjectId()}/databases/(default)/documents`;
}

function getRunQueryPath() {
  return `https://firestore.googleapis.com/v1/projects/${getProjectId()}/databases/(default)/documents:runQuery`;
}

function getCommitPath() {
  return `https://firestore.googleapis.com/v1/projects/${getProjectId()}/databases/(default)/documents:commit`;
}

function toDocumentName(path: string) {
  return `projects/${getProjectId()}/databases/(default)/documents/${path}`;
}

async function requestFirestore<T>(path: string, idToken: string, init?: RequestInit) {
  const response = await fetch(`${getBasePath()}/${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
      ...(init?.headers ?? {}),
    },
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
    throw new Error(`FIRESTORE_HTTP_${response.status}${detail ? `_${detail}` : ""}`);
  }

  return (await response.json()) as T;
}

function familyIdFromMemberDocumentName(name: string) {
  const match = name.match(/\/families\/([^/]+)\/members\//);
  return match?.[1] ?? "";
}

export async function getDocument(path: string, idToken: string) {
  return requestFirestore<FirestoreDocument>(path, idToken);
}

export async function listDocuments(path: string, idToken: string, pageSize = 50) {
  const encodedPath = `${path}?pageSize=${pageSize}`;
  const response = await requestFirestore<{ documents?: FirestoreDocument[] }>(
    encodedPath,
    idToken,
  );
  return response.documents ?? [];
}

// Firestore REST caps documents.list pageSize at 300 and a single call never
// returns more than one page, so listDocuments silently drops anything beyond
// that. listAllDocuments follows nextPageToken until the collection is
// exhausted (or the safety cap is hit) so callers can read an entire collection.
export async function listAllDocuments(
  path: string,
  idToken: string,
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
    const response = await requestFirestore<{
      documents?: FirestoreDocument[];
      nextPageToken?: string;
    }>(`${path}?${params.toString()}`, idToken);
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

export async function patchDocument(
  path: string,
  fields: Record<string, FirestoreValue>,
  idToken: string,
  updateMask: string[] = [],
) {
  const query =
    updateMask.length === 0
      ? ""
      : `?${updateMask
          .map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`)
          .join("&")}`;

  return requestFirestore<FirestoreDocument>(`${path}${query}`, idToken, {
    method: "PATCH",
    body: JSON.stringify({ fields }),
  });
}

export async function createOrReplaceDocument(
  path: string,
  fields: Record<string, FirestoreValue>,
  idToken: string,
) {
  return requestFirestore<FirestoreDocument>(path, idToken, {
    method: "PATCH",
    body: JSON.stringify({ fields }),
  });
}

export async function deleteDocument(path: string, idToken: string) {
  const response = await fetch(`${getBasePath()}/${path}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
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
    throw new Error(`FIRESTORE_HTTP_${response.status}${detail ? `_${detail}` : ""}`);
  }
}

type CommitWrite = {
  update: {
    path: string;
    fields: Record<string, FirestoreValue>;
    updateMask?: string[];
    currentDocument?: {
      exists?: boolean;
      updateTime?: string;
    };
  };
};

export async function commitWrites(writes: CommitWrite[], idToken: string) {
  const payload = {
    writes: writes.map((write) => ({
      update: {
        name: toDocumentName(write.update.path),
        fields: write.update.fields,
      },
      updateMask: write.update.updateMask
        ? { fieldPaths: write.update.updateMask }
        : undefined,
      currentDocument: write.update.currentDocument,
    })),
  };

  const response = await fetch(getCommitPath(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(payload),
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
    throw new Error(`FIRESTORE_HTTP_${response.status}${detail ? `_${detail}` : ""}`);
  }
}

export async function findFirstFamilyIdByMemberUid(uid: string, idToken: string) {
  if (!uid) {
    return "";
  }

  const response = await fetch(getRunQueryPath(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "members", allDescendants: true }],
        where: {
          fieldFilter: {
            field: { fieldPath: "uid" },
            op: "EQUAL",
            value: { stringValue: uid },
          },
        },
        limit: 20,
      },
    }),
    cache: "no-store",
  });

  if (response.status === 403) {
    return "";
  }

  if (!response.ok) {
    let detail = "";
    try {
      const json = (await response.json()) as { error?: { message?: string } };
      detail = json.error?.message ?? "";
    } catch {
      detail = await response.text();
    }
    throw new Error(`FIRESTORE_HTTP_${response.status}${detail ? `_${detail}` : ""}`);
  }

  const rows = (await response.json()) as FirestoreRunQueryResult[];
  for (const row of rows) {
    const doc = row.document;
    if (!doc) {
      continue;
    }
    if (readBoolean(doc.fields, "deleted")) {
      continue;
    }
    const familyId = familyIdFromMemberDocumentName(doc.name);
    if (familyId) {
      return familyId;
    }
  }

  return "";
}

export async function findFirstFamilyIdByMemberEmail(email: string, idToken: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    return "";
  }

  const response = await fetch(getRunQueryPath(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "members", allDescendants: true }],
        where: {
          fieldFilter: {
            field: { fieldPath: "email" },
            op: "EQUAL",
            value: { stringValue: normalizedEmail },
          },
        },
        limit: 20,
      },
    }),
    cache: "no-store",
  });

  if (response.status === 403) {
    return "";
  }

  if (!response.ok) {
    let detail = "";
    try {
      const json = (await response.json()) as { error?: { message?: string } };
      detail = json.error?.message ?? "";
    } catch {
      detail = await response.text();
    }
    throw new Error(`FIRESTORE_HTTP_${response.status}${detail ? `_${detail}` : ""}`);
  }

  const rows = (await response.json()) as FirestoreRunQueryResult[];
  for (const row of rows) {
    const doc = row.document;
    if (!doc) {
      continue;
    }
    if (readBoolean(doc.fields, "deleted")) {
      continue;
    }
    const familyId = familyIdFromMemberDocumentName(doc.name);
    if (familyId) {
      return familyId;
    }
  }

  return "";
}

// Runs a Firestore structured query. When `parentPath` is provided the query is
// scoped to that document's subcollections (e.g. "families/{familyId}"),
// otherwise it runs from the database root. Returns the matched documents.
export async function runQuery(
  structuredQuery: Record<string, unknown>,
  idToken: string,
  parentPath = "",
): Promise<FirestoreDocument[]> {
  const url = parentPath
    ? `${getBasePath()}/${parentPath}:runQuery`
    : getRunQueryPath();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ structuredQuery }),
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
    throw new Error(`FIRESTORE_HTTP_${response.status}${detail ? `_${detail}` : ""}`);
  }

  const rows = (await response.json()) as FirestoreRunQueryResult[];
  return rows
    .map((row) => row.document)
    .filter((doc): doc is FirestoreDocument => Boolean(doc));
}

export function documentIdFromName(name: string) {
  const parts = name.split("/");
  return parts[parts.length - 1] ?? "";
}

export type PlainFirestoreValue =
  | string
  | number
  | boolean
  | null
  | PlainFirestoreValue[]
  | { [key: string]: PlainFirestoreValue };

// Converts a single Firestore REST value into a plain JSON value. Useful for
// support tooling and data exports that need human/JSON-friendly records.
export function firestoreValueToPlain(value: FirestoreValue): PlainFirestoreValue {
  if ("stringValue" in value) {
    return value.stringValue;
  }
  if ("integerValue" in value) {
    const parsed = Number(value.integerValue);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if ("timestampValue" in value) {
    return value.timestampValue;
  }
  if ("booleanValue" in value) {
    return value.booleanValue;
  }
  if ("arrayValue" in value) {
    return (value.arrayValue.values ?? []).map(firestoreValueToPlain);
  }
  if ("nullValue" in value) {
    return null;
  }
  return Object.fromEntries(
    Object.entries(value.mapValue.fields ?? {}).map(([key, entry]) => [
      key,
      firestoreValueToPlain(entry),
    ]),
  );
}

export function fieldsToPlainObject(
  fields: Record<string, FirestoreValue> | undefined,
): Record<string, PlainFirestoreValue> {
  return Object.fromEntries(
    Object.entries(fields ?? {}).map(([key, value]) => [key, firestoreValueToPlain(value)]),
  );
}

export function readString(
  fields: Record<string, FirestoreValue> | undefined,
  key: string,
) {
  const value = fields?.[key];
  if (!value || !("stringValue" in value)) {
    return "";
  }
  return value.stringValue;
}

export function readTimestamp(
  fields: Record<string, FirestoreValue> | undefined,
  key: string,
) {
  const value = fields?.[key];
  if (!value) {
    return "";
  }
  if ("timestampValue" in value) {
    return value.timestampValue;
  }
  if ("stringValue" in value) {
    return value.stringValue;
  }
  return "";
}

export function readBoolean(
  fields: Record<string, FirestoreValue> | undefined,
  key: string,
) {
  const value = fields?.[key];
  if (!value) {
    return false;
  }
  if ("booleanValue" in value) {
    return value.booleanValue;
  }
  if ("stringValue" in value) {
    return value.stringValue === "true";
  }
  return false;
}

export function readInteger(
  fields: Record<string, FirestoreValue> | undefined,
  key: string,
) {
  const value = fields?.[key];
  if (!value) {
    return 0;
  }
  if ("integerValue" in value) {
    const parsed = Number(value.integerValue);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if ("stringValue" in value) {
    const parsed = Number(value.stringValue);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function readStringArray(
  fields: Record<string, FirestoreValue> | undefined,
  key: string,
) {
  const value = fields?.[key];
  if (!value || !("arrayValue" in value)) {
    return [];
  }

  return (value.arrayValue.values ?? [])
    .map((entry) => ("stringValue" in entry ? entry.stringValue : ""))
    .filter((entry) => entry.length > 0);
}

export function stringField(value: string): FirestoreValue {
  return { stringValue: value };
}

export function timestampField(value: string): FirestoreValue {
  return { timestampValue: value };
}

export function boolField(value: boolean): FirestoreValue {
  return { booleanValue: value };
}

export function nullField(): FirestoreValue {
  return { nullValue: null };
}

export function integerField(value: number): FirestoreValue {
  return { integerValue: String(Math.max(0, Math.floor(value))) };
}

export function signedIntegerField(value: number): FirestoreValue {
  return { integerValue: String(Math.floor(value)) };
}

export function stringArrayField(values: string[]): FirestoreValue {
  return {
    arrayValue: {
      values: values.map((value) => ({ stringValue: value })),
    },
  };
}

export function mapField(fields: Record<string, FirestoreValue>): FirestoreValue {
  return {
    mapValue: {
      fields,
    },
  };
}

export function arrayField(values: FirestoreValue[]): FirestoreValue {
  return {
    arrayValue: {
      values,
    },
  };
}
