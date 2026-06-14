import {
  adminGetDocument,
  adminListAllDocuments,
  adminListDocuments,
} from "@/lib/firestore/admin";
import {
  documentIdFromName,
  readBoolean,
  readInteger,
  readString,
  readTimestamp,
} from "@/lib/firestore/rest";
import { ACHIEVEMENT_CATALOG } from "@/lib/achievements/catalog";
import type { ApiTokenRecord } from "@/lib/public-api/types";

type PublicApiMember = {
  id: string;
  uid: string;
  displayName: string;
  email: string;
  role: "admin" | "player";
  status: "active" | "invited";
};

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

async function listFamilyMembers(familyId: string): Promise<PublicApiMember[]> {
  const docs = await adminListDocuments(`families/${familyId}/members`, 200);
  return docs
    .map((doc) => ({
      id: documentIdFromName(doc.name),
      uid: readString(doc.fields, "uid"),
      displayName: readString(doc.fields, "name") || "Family member",
      email: readString(doc.fields, "email"),
      role: readString(doc.fields, "role") === "admin" ? ("admin" as const) : ("player" as const),
      status: readString(doc.fields, "status") === "active" ? ("active" as const) : ("invited" as const),
      deleted: readBoolean(doc.fields, "deleted"),
    }))
    .filter((member) => !member.deleted)
    .map(({ deleted: _deleted, ...member }) => member);
}

async function getViewerContext(token: ApiTokenRecord) {
  const members = await listFamilyMembers(token.familyId);
  const userDoc = await adminGetDocument(`users/${token.userId}`).catch(() => null);
  const email = normalizeEmail(readString(userDoc?.fields, "email"));
  const viewer =
    members.find((member) => member.uid === token.userId || member.id === token.userId) ??
    members.find((member) => email && normalizeEmail(member.email) === email) ??
    null;
  return {
    viewer,
    viewerRole: viewer?.role ?? "player",
    members,
    userDoc,
  };
}

export async function getPublicApiMe(token: ApiTokenRecord) {
  const { viewer, viewerRole, userDoc } = await getViewerContext(token);
  let familyName = "My Family";
  try {
    const familyDoc = await adminGetDocument(`families/${token.familyId}`);
    familyName = readString(familyDoc.fields, "name") || familyName;
  } catch {
    familyName = "My Family";
  }
  return {
    userId: token.userId,
    familyId: token.familyId,
    memberId: viewer?.id ?? token.userId,
    displayName: viewer?.displayName || readString(userDoc?.fields, "name") || "Family member",
    email: readString(userDoc?.fields, "email") || viewer?.email || "",
    role: viewerRole,
    familyName,
  };
}

export async function listVisiblePlayers(token: ApiTokenRecord) {
  const { viewer, viewerRole, members } = await getViewerContext(token);
  const visible = viewerRole === "admin" ? members : members.filter((member) => member.id === viewer?.id);
  return visible
    .filter((member) => member.role === "player")
    .map((member) => ({
      playerId: member.id,
      uid: member.uid || null,
      displayName: member.displayName,
      status: member.status,
    }));
}

export async function getVisiblePlayer(token: ApiTokenRecord, playerId: string) {
  const { viewer, viewerRole, members } = await getViewerContext(token);
  const player =
    members.find((member) => member.id === playerId || (member.uid && member.uid === playerId)) ?? null;
  if (!player || player.role !== "player") {
    return { status: "not_found" as const };
  }
  if (viewerRole !== "admin" && player.id !== viewer?.id && player.uid !== token.userId) {
    return { status: "permission_denied" as const };
  }
  return { status: "ok" as const, player };
}

export async function getPlayerCoins(token: ApiTokenRecord, playerId: string) {
  const resolved = await getVisiblePlayer(token, playerId);
  if (resolved.status !== "ok") {
    return resolved;
  }
  const playerUid = resolved.player.uid || resolved.player.id;
  const userDoc = await adminGetDocument(`users/${playerUid}`).catch(() => null);
  const coinBalance = Math.max(0, readInteger(userDoc?.fields, "walletBalance"));
  const choreDocs = await adminListAllDocuments(`families/${token.familyId}/chores`, { cap: 1000 }).catch(() => []);
  const aliases = new Set([resolved.player.id, resolved.player.uid, normalizeEmail(resolved.player.email)].filter(Boolean));
  let pendingCoins = 0;
  let approvedCoins = 0;
  for (const chore of choreDocs) {
    if (readBoolean(chore.fields, "deleted")) {
      continue;
    }
    if (!aliases.has(readString(chore.fields, "assigneeId"))) {
      continue;
    }
    const value = Math.max(0, readInteger(chore.fields, "coinValue"));
    const status = readString(chore.fields, "status");
    if (status === "Submitted") {
      pendingCoins += value;
    }
    if (status === "Approved") {
      approvedCoins += value;
    }
  }
  return {
    status: "ok" as const,
    data: {
      playerId: resolved.player.id,
      displayName: resolved.player.displayName,
      coinBalance,
      pendingCoins,
      approvedCoins: approvedCoins || coinBalance,
      updatedAt: readTimestamp(userDoc?.fields, "walletUpdatedAt") || readTimestamp(userDoc?.fields, "updatedAt") || new Date().toISOString(),
    },
  };
}

export async function getPlayerChoresToday(token: ApiTokenRecord, playerId: string) {
  const resolved = await getVisiblePlayer(token, playerId);
  if (resolved.status !== "ok") {
    return resolved;
  }
  const today = new Date().toISOString().slice(0, 10);
  const aliases = new Set([resolved.player.id, resolved.player.uid, normalizeEmail(resolved.player.email)].filter(Boolean));
  const choreDocs = await adminListAllDocuments(`families/${token.familyId}/chores`, { cap: 1000 }).catch(() => []);
  return {
    status: "ok" as const,
    data: choreDocs
      .filter((doc) => !readBoolean(doc.fields, "deleted"))
      .filter((doc) => aliases.has(readString(doc.fields, "assigneeId")))
      .filter((doc) => {
        const dueDate = readString(doc.fields, "dueDate");
        return !dueDate || dueDate === today;
      })
      .map((doc) => ({
        id: documentIdFromName(doc.name),
        title: readString(doc.fields, "title"),
        status: readString(doc.fields, "status") || "Open",
        dueDate: readString(doc.fields, "dueDate") || null,
        coinValue: Math.max(0, readInteger(doc.fields, "coinValue")),
        requireApproval: readBoolean(doc.fields, "requireApproval"),
        updatedAt: readTimestamp(doc.fields, "updatedAt") || null,
      })),
  };
}

export async function getRecentPlayerAchievements(token: ApiTokenRecord, playerId: string) {
  const resolved = await getVisiblePlayer(token, playerId);
  if (resolved.status !== "ok") {
    return resolved;
  }
  const playerUid = resolved.player.uid || resolved.player.id;
  const progressDocs = await adminListDocuments(`users/${playerUid}/achievements`, 100).catch(() => []);
  const completed = progressDocs
    .map((doc) => {
      const achievementId = documentIdFromName(doc.name);
      const catalog = ACHIEVEMENT_CATALOG.find((entry) => entry.id === achievementId);
      return {
        achievementId,
        title: catalog?.title ?? achievementId,
        wittyTitle: catalog?.wittyTitle ?? "",
        description: catalog?.description ?? "",
        completedAt: readTimestamp(doc.fields, "completedAt"),
        percent: Math.max(0, readInteger(doc.fields, "percent")),
      };
    })
    .filter((entry) => entry.completedAt)
    .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt))
    .slice(0, 10);
  return { status: "ok" as const, data: completed };
}
