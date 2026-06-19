/**
 * Persistence for the Athena integration connection state.
 *
 * One record per family at `families/{familyId}/integrations/athena`. It records
 * that we connected, who did it, the resolved Athena identity, and the id of the
 * Family Chores API token we minted for Athena (so disconnect can revoke it).
 * No secrets are stored here — the raw token lives only in Athena.
 */
import {
  adminCreateOrReplaceDocument,
  adminDeleteDocument,
  adminGetDocument,
  adminListDocuments,
  adminPatchDocument,
} from "@/lib/firestore/admin";
import {
  boolField,
  documentIdFromName,
  readBoolean,
  readString,
  readTimestamp,
  stringField,
  timestampField,
  type FirestoreValue,
} from "@/lib/firestore/rest";

const ATHENA_DOC = "integrations/athena";
const ATHENA_CHILDREN_COLLECTION = "integrationAthenaChildren";

function athenaDocPath(familyId: string) {
  return `families/${familyId}/${ATHENA_DOC}`;
}

export type AthenaConnectionRecord = {
  connected: boolean;
  connectedByUid: string;
  email: string;
  playerId: string;
  displayName: string;
  familyName: string;
  createdAccount: boolean;
  apiTokenId: string;
  connectedAt: string;
  updatedAt: string;
};

function isNotFound(error: unknown) {
  const reason = error instanceof Error ? error.message : "";
  return reason.includes("FIRESTORE_ADMIN_HTTP_404") || reason.includes("FIRESTORE_HTTP_404");
}

/** Read the connection record for a family, or null when never connected. */
export async function getAthenaConnection(familyId: string): Promise<AthenaConnectionRecord | null> {
  try {
    const doc = await adminGetDocument(athenaDocPath(familyId));
    return {
      connected: readBoolean(doc.fields, "connected"),
      connectedByUid: readString(doc.fields, "connectedByUid"),
      email: readString(doc.fields, "email"),
      playerId: readString(doc.fields, "playerId"),
      displayName: readString(doc.fields, "displayName"),
      familyName: readString(doc.fields, "familyName"),
      createdAccount: readBoolean(doc.fields, "createdAccount"),
      apiTokenId: readString(doc.fields, "apiTokenId"),
      connectedAt: readTimestamp(doc.fields, "connectedAt"),
      updatedAt: readTimestamp(doc.fields, "updatedAt"),
    };
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

/** Persist a successful connection (full replace). */
export async function saveAthenaConnection(
  familyId: string,
  input: {
    connectedByUid: string;
    email: string;
    playerId: string;
    displayName: string;
    familyName: string;
    createdAccount: boolean;
    apiTokenId: string;
  },
) {
  const now = new Date().toISOString();
  await adminCreateOrReplaceDocument(athenaDocPath(familyId), {
    connected: boolField(true),
    connectedByUid: stringField(input.connectedByUid),
    email: stringField(input.email),
    playerId: stringField(input.playerId),
    displayName: stringField(input.displayName),
    familyName: stringField(input.familyName),
    createdAccount: boolField(input.createdAccount),
    apiTokenId: stringField(input.apiTokenId),
    connectedAt: timestampField(now),
    updatedAt: timestampField(now),
  });
}

// --- Per-child enablement -------------------------------------------------
// One doc per Family Chores child player at
// `families/{familyId}/integrationAthenaChildren/{playerId}`, recording which
// Athena child profile it links to (for UI). No token/secret is stored.

export type AthenaChildLink = {
  playerId: string;
  childUuid: string;
  displayName: string;
  enabledByUid: string;
  enabledAt: string;
};

function childDocPath(familyId: string, playerId: string) {
  return `families/${familyId}/${ATHENA_CHILDREN_COLLECTION}/${playerId}`;
}

function readChildLink(
  fields: Record<string, FirestoreValue> | undefined,
  playerId: string,
): AthenaChildLink {
  return {
    playerId,
    childUuid: readString(fields, "childUuid"),
    displayName: readString(fields, "displayName"),
    enabledByUid: readString(fields, "enabledByUid"),
    enabledAt: readTimestamp(fields, "enabledAt"),
  };
}

export async function getAthenaChildLink(
  familyId: string,
  playerId: string,
): Promise<AthenaChildLink | null> {
  try {
    const doc = await adminGetDocument(childDocPath(familyId, playerId));
    return readChildLink(doc.fields, playerId);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function listAthenaChildLinks(familyId: string): Promise<AthenaChildLink[]> {
  try {
    const docs = await adminListDocuments(
      `families/${familyId}/${ATHENA_CHILDREN_COLLECTION}`,
      200,
    );
    return docs.map((doc) => readChildLink(doc.fields, documentIdFromName(doc.name)));
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
}

export async function saveAthenaChildLink(
  familyId: string,
  playerId: string,
  input: { childUuid: string; displayName: string; enabledByUid: string },
) {
  const now = new Date().toISOString();
  await adminCreateOrReplaceDocument(childDocPath(familyId, playerId), {
    playerId: stringField(playerId),
    childUuid: stringField(input.childUuid),
    displayName: stringField(input.displayName),
    enabledByUid: stringField(input.enabledByUid),
    enabledAt: timestampField(now),
  });
}

export async function deleteAthenaChildLink(familyId: string, playerId: string) {
  try {
    await adminDeleteDocument(childDocPath(familyId, playerId));
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

/** Mark the record disconnected, preserving history. Token id is cleared. */
export async function clearAthenaConnection(familyId: string) {
  const now = new Date().toISOString();
  await adminPatchDocument(
    athenaDocPath(familyId),
    {
      connected: boolField(false),
      apiTokenId: stringField(""),
      updatedAt: timestampField(now),
    },
    ["connected", "apiTokenId", "updatedAt"],
  );
}
