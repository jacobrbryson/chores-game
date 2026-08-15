import {
  adminListAllDocuments,
  adminListCollectionIds,
  adminRunQueryAllInCollectionGroup,
} from "@/lib/firestore/admin";
import type { FirestoreDocument, FirestoreValue } from "@/lib/firestore/rest";

/**
 * Firestore read layer for the email-keying dry run. READ ONLY — this module
 * exposes no write path at all.
 *
 * Two backends:
 *  - `admin`    : the real project, through the `admin*` helpers in
 *                 `lib/firestore/admin.ts` (service-account credentials).
 *  - `emulator` : the local Firestore emulator, used to exercise the script
 *                 against seeded fixture data. It re-implements the same three
 *                 calls against `FIRESTORE_EMULATOR_HOST` rather than
 *                 introducing an emulator branch into production code.
 *
 * Every read is cursor-paginated to exhaustion and reports whether it actually
 * reached the end. A dry run that silently under-counts would be worse than no
 * dry run: `lib/newsletters/service.ts` reads `families` with a hard cap of 500
 * and drops the overflow, and `api/support/stale-invites` reads members with a
 * single unpaginated `limit: 2000` page. Neither pattern is inherited here.
 */

export type ScanResult = {
  documents: FirestoreDocument[];
  /** False means the safety cap stopped the scan before the collection ended. */
  complete: boolean;
  cap: number;
};

export type DryRunReader = {
  mode: "admin" | "emulator";
  projectId: string;
  listCollection(path: string, cap: number): Promise<ScanResult>;
  scanCollectionGroup(collectionId: string, cap: number): Promise<ScanResult>;
  listCollectionIds(parentPath?: string): Promise<string[]>;
};

function requireProjectId() {
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  if (!projectId) {
    throw new Error(
      "FIREBASE_PROJECT_ID is not set. Export it (and admin credentials) before running the dry run.",
    );
  }
  return projectId;
}

function createAdminReader(): DryRunReader {
  return {
    mode: "admin",
    projectId: requireProjectId(),
    async listCollection(path, cap) {
      // adminListAllDocuments follows nextPageToken but returns silently at the
      // cap, so ask for one more than the budget and treat the overflow as the
      // truncation signal.
      const documents = await adminListAllDocuments(path, { cap: cap + 1, pageSize: 300 });
      if (documents.length > cap) {
        return { documents: documents.slice(0, cap), complete: false, cap };
      }
      return { documents, complete: true, cap };
    },
    async scanCollectionGroup(collectionId, cap) {
      const { documents, truncated } = await adminRunQueryAllInCollectionGroup(collectionId, {
        cap,
        pageSize: 1000,
      });
      return { documents, complete: !truncated, cap };
    },
    listCollectionIds(parentPath = "") {
      return adminListCollectionIds(parentPath);
    },
  };
}

function createEmulatorReader(host: string): DryRunReader {
  // `firebase emulators:exec` exports GCLOUD_PROJECT but not FIREBASE_PROJECT_ID,
  // so accept either when talking to the emulator.
  const projectId =
    process.env.FIREBASE_PROJECT_ID?.trim() ||
    process.env.GCLOUD_PROJECT?.trim() ||
    process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
    "";
  if (!projectId) {
    throw new Error("Set FIREBASE_PROJECT_ID (or GCLOUD_PROJECT) when using the emulator.");
  }
  const origin = host.startsWith("http") ? host : `http://${host}`;
  const documentsUrl = `${origin}/v1/projects/${projectId}/databases/(default)/documents`;

  async function request<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        // The emulator accepts the literal "owner" bearer token as full access.
        Authorization: "Bearer owner",
        ...(init?.headers ?? {}),
      },
    });
    if (!response.ok) {
      throw new Error(
        `FIRESTORE_EMULATOR_HTTP_${response.status}_${(await response.text()).slice(0, 240)}`,
      );
    }
    return (await response.json()) as T;
  }

  return {
    mode: "emulator",
    projectId,
    async listCollection(path, cap) {
      const documents: FirestoreDocument[] = [];
      let pageToken = "";
      do {
        const params = new URLSearchParams({ pageSize: "300" });
        if (pageToken) params.set("pageToken", pageToken);
        const page = await request<{
          documents?: FirestoreDocument[];
          nextPageToken?: string;
        }>(`${documentsUrl}/${path}?${params.toString()}`);
        for (const doc of page.documents ?? []) {
          documents.push(doc);
          if (documents.length > cap) {
            return { documents: documents.slice(0, cap), complete: false, cap };
          }
        }
        pageToken = page.nextPageToken ?? "";
      } while (pageToken);
      return { documents, complete: true, cap };
    },
    async scanCollectionGroup(collectionId, cap) {
      const pageSize = 1000;
      const documents: FirestoreDocument[] = [];
      let cursor = "";
      for (;;) {
        const structuredQuery: Record<string, unknown> = {
          from: [{ collectionId, allDescendants: true }],
          orderBy: [{ field: { fieldPath: "__name__" }, direction: "ASCENDING" }],
          limit: pageSize,
          ...(cursor
            ? { startAt: { before: false, values: [{ referenceValue: cursor }] } }
            : {}),
        };
        const rows = await request<Array<{ document?: FirestoreDocument }>>(
          `${documentsUrl}:runQuery`,
          { method: "POST", body: JSON.stringify({ structuredQuery }) },
        );
        const page = rows
          .map((row) => row.document)
          .filter((doc): doc is FirestoreDocument => Boolean(doc?.name));
        for (const doc of page) {
          documents.push(doc);
          if (documents.length > cap) {
            return { documents: documents.slice(0, cap), complete: false, cap };
          }
        }
        if (page.length < pageSize) break;
        cursor = page[page.length - 1]?.name ?? "";
        if (!cursor) break;
      }
      return { documents, complete: true, cap };
    },
    async listCollectionIds(parentPath = "") {
      const url = parentPath
        ? `${documentsUrl}/${parentPath}:listCollectionIds`
        : `${documentsUrl}:listCollectionIds`;
      const collectionIds: string[] = [];
      let pageToken = "";
      do {
        const response = await request<{ collectionIds?: string[]; nextPageToken?: string }>(url, {
          method: "POST",
          body: JSON.stringify({ pageSize: 100, ...(pageToken ? { pageToken } : {}) }),
        });
        collectionIds.push(...(response.collectionIds ?? []));
        pageToken = response.nextPageToken ?? "";
      } while (pageToken);
      return collectionIds;
    },
  };
}

export function createDryRunReader(): DryRunReader {
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST?.trim();
  return emulatorHost ? createEmulatorReader(emulatorHost) : createAdminReader();
}

/** `projects/P/databases/(default)/documents/a/b/c` -> `a/b/c`. */
export function relativePathFromName(name: string) {
  const marker = "/documents/";
  const index = name.indexOf(marker);
  return index === -1 ? name : name.slice(index + marker.length);
}

export function documentIdOf(name: string) {
  const relative = relativePathFromName(name);
  return relative.slice(relative.lastIndexOf("/") + 1);
}

/**
 * Family id for a `families/{familyId}/...` document, or "" for anything else.
 * Collection-group scans match by collection id alone, so a `members`
 * subcollection hanging off some other parent would otherwise be miscounted.
 */
export function familyIdFromName(name: string) {
  const segments = relativePathFromName(name).split("/");
  return segments[0] === "families" && segments.length >= 2 ? segments[1] : "";
}

export type StringHit = { fieldPath: string; value: string };

/**
 * Every string leaf in a Firestore document, with a readable path. Arrays get a
 * `[]` suffix so `assigneeIds[]` is distinguishable from `assigneeId`.
 */
export function walkStringValues(
  fields: Record<string, FirestoreValue> | undefined,
  prefix = "",
): StringHit[] {
  const hits: StringHit[] = [];
  for (const [key, value] of Object.entries(fields ?? {})) {
    collectStrings(value, prefix ? `${prefix}.${key}` : key, hits);
  }
  return hits;
}

function collectStrings(value: FirestoreValue, fieldPath: string, hits: StringHit[]) {
  if ("stringValue" in value) {
    hits.push({ fieldPath, value: value.stringValue });
    return;
  }
  if ("arrayValue" in value) {
    for (const entry of value.arrayValue.values ?? []) {
      collectStrings(entry, `${fieldPath}[]`, hits);
    }
    return;
  }
  if ("mapValue" in value) {
    for (const [key, entry] of Object.entries(value.mapValue.fields ?? {})) {
      collectStrings(entry, `${fieldPath}.${key}`, hits);
    }
  }
}

export function readStringField(
  fields: Record<string, FirestoreValue> | undefined,
  key: string,
): string {
  const value = fields?.[key];
  if (!value) return "";
  if ("stringValue" in value) return value.stringValue;
  if ("timestampValue" in value) return value.timestampValue;
  return "";
}

export function readBooleanField(
  fields: Record<string, FirestoreValue> | undefined,
  key: string,
): boolean {
  const value = fields?.[key];
  return Boolean(value && "booleanValue" in value && value.booleanValue);
}

export function readStringArrayField(
  fields: Record<string, FirestoreValue> | undefined,
  key: string,
): string[] {
  const value = fields?.[key];
  if (!value || !("arrayValue" in value)) return [];
  return (value.arrayValue.values ?? [])
    .map((entry) => ("stringValue" in entry ? entry.stringValue : ""))
    .filter(Boolean);
}
