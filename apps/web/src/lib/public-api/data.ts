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
  readStringArray,
  readTimestamp,
} from "@/lib/firestore/rest";
import { ACHIEVEMENT_CATALOG } from "@/lib/achievements/catalog";
import { parseFamilyCategories } from "@/lib/family/categories";
import {
  normalizeRecurrenceConfig,
  nextRecurringDueDate,
  recurrenceShortLabel,
} from "@/lib/chores/recurrence";
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
  // Any family member (parent/admin or child) can have coins and chores, so all
  // members are addressable here — admins see everyone, others see themselves.
  const visible = viewerRole === "admin" ? members : members.filter((member) => member.id === viewer?.id);
  return visible.map((member) => ({
    playerId: member.id,
    uid: member.uid || null,
    displayName: member.displayName,
    role: member.role,
    status: member.status,
  }));
}

export async function getVisiblePlayer(token: ApiTokenRecord, playerId: string) {
  const { viewer, viewerRole, members } = await getViewerContext(token);
  // Coins/chores belong to any member, so we don't restrict by role here — only
  // by visibility (non-admins may only read their own data).
  const player =
    members.find((member) => member.id === playerId || (member.uid && member.uid === playerId)) ?? null;
  if (!player) {
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

export type PlayerChoresQuery = {
  /** Convenience window — resolved into from/to day bounds when no explicit dates given. */
  range?: "today" | "tomorrow" | "yesterday" | "this-week" | "last-week" | "upcoming" | "all";
  /** Inclusive YYYY-MM-DD bounds; override `range` when provided. */
  from?: string;
  to?: string;
  /** "open" = still to-do, "completed" = submitted/approved, "all" = either. */
  status?: "open" | "completed" | "all";
  /** Case-insensitive category (e.g. "Vivacity") name filter. */
  category?: string;
  /**
   * Project future occurrences of recurring chores within the range (so
   * "What chores will I have tomorrow?" includes a daily chore due today).
   * Defaults on when the range reaches into the future.
   */
  includeRecurring?: boolean;
};

type ResolvedRange = { from: string | null; to: string | null };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function utcDayString(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(day: string, amount: number) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return utcDayString(date);
}

function startOfUtcWeek(day: string) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return utcDayString(date);
}

function resolveDateRange(query: PlayerChoresQuery, today: string): ResolvedRange {
  const from = query.from && ISO_DAY.test(query.from) ? query.from : "";
  const to = query.to && ISO_DAY.test(query.to) ? query.to : "";
  if (from || to) {
    return { from: from || null, to: to || null };
  }
  switch (query.range) {
    case "today":
      return { from: today, to: today };
    case "tomorrow":
      return { from: addUtcDays(today, 1), to: addUtcDays(today, 1) };
    case "yesterday":
      return { from: addUtcDays(today, -1), to: addUtcDays(today, -1) };
    case "this-week": {
      const start = startOfUtcWeek(today);
      return { from: start, to: addUtcDays(start, 6) };
    }
    case "last-week": {
      const start = addUtcDays(startOfUtcWeek(today), -7);
      return { from: start, to: addUtcDays(start, 6) };
    }
    case "upcoming":
      return { from: today, to: addUtcDays(today, 30) };
    default:
      return { from: null, to: null };
  }
}

function inRange(day: string, range: ResolvedRange) {
  if (!day) {
    return false;
  }
  if (range.from && day < range.from) {
    return false;
  }
  if (range.to && day > range.to) {
    return false;
  }
  return true;
}

function isCompletedStatus(status: string) {
  return status === "Submitted" || status === "Approved";
}

/**
 * Flexible chore query backing assistant questions like "What chores did I
 * complete last week?", "What's left to do today?", "What will I have
 * tomorrow?", and "What Vivacity chores do I have?". Read-only over the family
 * chore collection, scoped to a single visible player.
 */
export async function getPlayerChores(
  token: ApiTokenRecord,
  playerId: string,
  query: PlayerChoresQuery = {},
) {
  const resolved = await getVisiblePlayer(token, playerId);
  if (resolved.status !== "ok") {
    return resolved;
  }

  const today = utcDayString(new Date());
  const statusFilter = query.status ?? "all";
  const range = resolveDateRange(query, today);
  const rangeIncludesToday = inRange(today, range);
  // Project recurring occurrences when the caller looks at future dates, unless
  // explicitly disabled. Past-only windows (e.g. last week) never project.
  const includeRecurring =
    query.includeRecurring ??
    (statusFilter !== "completed" && (!range.to || range.to >= today));

  const [choreDocs, categoryDocs] = await Promise.all([
    adminListAllDocuments(`families/${token.familyId}/chores`, { cap: 1000 }).catch(() => []),
    adminListDocuments(`families/${token.familyId}/categories`, 300).catch(() => []),
  ]);
  const categories = parseFamilyCategories(categoryDocs);
  const categoryById = new Map(categories.map((category) => [category.id, category] as const));
  const categoryNameFilter = query.category?.trim().toLowerCase() || "";

  const aliases = new Set(
    [resolved.player.id, resolved.player.uid, normalizeEmail(resolved.player.email)].filter(Boolean),
  );

  const results: Array<{
    id: string;
    title: string;
    status: string;
    completed: boolean;
    dueDate: string | null;
    completedAt: string | null;
    coinValue: number;
    requireApproval: boolean;
    categories: Array<{ id: string; name: string; color: string }>;
    responsibilityPillar: string | null;
    recurrence: string | null;
    projected: boolean;
  }> = [];

  for (const doc of choreDocs) {
    if (readBoolean(doc.fields, "deleted")) {
      continue;
    }
    if (!aliases.has(readString(doc.fields, "assigneeId"))) {
      continue;
    }

    const categoryIds = readStringArray(doc.fields, "categoryIds");
    const resolvedCategories = categoryIds
      .map((id) => categoryById.get(id))
      .filter((category): category is (typeof categories)[number] => Boolean(category));
    if (
      categoryNameFilter &&
      !resolvedCategories.some((category) => category.name.toLowerCase() === categoryNameFilter)
    ) {
      continue;
    }

    const status = readString(doc.fields, "status") || "Open";
    const completed = isCompletedStatus(status);
    const completedAt = completed
      ? readTimestamp(doc.fields, "submittedAt") || readTimestamp(doc.fields, "updatedAt") || ""
      : "";
    const dueDate = readString(doc.fields, "dueDate");
    const coinValue = Math.max(0, readInteger(doc.fields, "coinValue"));
    const requireApproval = readBoolean(doc.fields, "requireApproval");
    const responsibilityPillar = readString(doc.fields, "responsibilityPillar") || null;
    const recurrence = normalizeRecurrenceConfig({
      recurrenceType: readString(doc.fields, "recurrenceType"),
      recurrenceInterval: readInteger(doc.fields, "recurrenceInterval"),
      recurrenceUnit: readString(doc.fields, "recurrenceUnit"),
      recurrenceDays: readStringArray(doc.fields, "recurrenceDays"),
    });
    const recurrenceLabel = recurrenceShortLabel(recurrence) || null;
    const serializedCategories = resolvedCategories.map((category) => ({
      id: category.id,
      name: category.name,
      color: category.color,
    }));

    const statusAllows =
      statusFilter === "all" ||
      (statusFilter === "completed" && completed) ||
      (statusFilter === "open" && !completed);

    // A chore with no due date is part of "today" on the dashboard, so include
    // those open items whenever today falls within the requested window.
    const datePasses = completed
      ? inRange(completedAt.slice(0, 10), range)
      : range.from || range.to
        ? inRange(dueDate, range) || (!dueDate && rangeIncludesToday)
        : true;

    if (statusAllows && datePasses) {
      results.push({
        id: documentIdFromName(doc.name),
        title: readString(doc.fields, "title"),
        status,
        completed,
        dueDate: dueDate || null,
        completedAt: completedAt || null,
        coinValue,
        requireApproval,
        categories: serializedCategories,
        responsibilityPillar,
        recurrence: recurrenceLabel,
        projected: false,
      });
    }

    // Project upcoming occurrences of live recurring chores into the window so
    // future-looking questions ("tomorrow") surface chores that recur forward
    // from a still-open instance.
    if (
      includeRecurring &&
      !completed &&
      range.to &&
      recurrence.recurrenceType !== "none" &&
      recurrence.recurrenceType !== "instant"
    ) {
      let cursor = dueDate && ISO_DAY.test(dueDate) ? dueDate : today;
      for (let i = 0; i < 60; i += 1) {
        const next = nextRecurringDueDate(cursor, recurrence, today);
        if (!next || next <= cursor || next > range.to) {
          break;
        }
        cursor = next;
        if (next < (range.from ?? next) || next <= today) {
          continue;
        }
        const projectedAllows = statusFilter === "all" || statusFilter === "open";
        if (projectedAllows) {
          results.push({
            id: `${documentIdFromName(doc.name)}@${next}`,
            title: readString(doc.fields, "title"),
            status: "Upcoming",
            completed: false,
            dueDate: next,
            completedAt: null,
            coinValue,
            requireApproval,
            categories: serializedCategories,
            responsibilityPillar,
            recurrence: recurrenceLabel,
            projected: true,
          });
        }
      }
    }
  }

  results.sort((a, b) => {
    const aKey = a.completedAt || a.dueDate || "";
    const bKey = b.completedAt || b.dueDate || "";
    return aKey.localeCompare(bKey);
  });

  return {
    status: "ok" as const,
    data: {
      playerId: resolved.player.id,
      displayName: resolved.player.displayName,
      range: { from: range.from, to: range.to },
      statusFilter,
      category: query.category?.trim() || null,
      chores: results,
    },
  };
}
