import { adminGetDocument, adminListAllDocuments, adminListDocuments } from "@/lib/firestore/admin";
import {
  documentIdFromName,
  readBoolean,
  readInteger,
  readString,
  readStringArray,
  readTimestamp,
} from "@/lib/firestore/rest";
import { computeWeeklyFamilyHighlightMetrics, loadNewsletterFamilyContext } from "@/lib/newsletters/metrics";
import { getPreviousWeeklyWindow } from "@/lib/newsletters/window";

export type SupportFamilyOverview = {
  family: {
    id: string;
    name: string;
    createdAt: string;
    createdBy: string;
    createdByEmail: string;
    defaultLocale: string;
    lastWeeklyHighlightSentAt: string;
    totalMembers: number;
    activeMembers: number;
    adminCount: number;
  };
  weeklyWindow: {
    start: string;
    end: string;
  };
  metrics: Awaited<ReturnType<typeof computeWeeklyFamilyHighlightMetrics>>;
  members: Array<{
    id: string;
    uid: string;
    name: string;
    email: string;
    role: string;
    status: string;
    joinedAt: string;
    walletBalance: number;
    lastSignInAt: string;
    weeklyCompletedChores: number;
  }>;
};

function isWithinWindow(value: string, window: { weekStart: string; weekEnd: string }) {
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) {
    return false;
  }
  return millis >= Date.parse(window.weekStart) && millis <= Date.parse(window.weekEnd);
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export async function loadSupportFamilyOverview(familyId: string): Promise<SupportFamilyOverview | null> {
  const window = getPreviousWeeklyWindow();
  const newsletterContextPromise = loadNewsletterFamilyContext(familyId).catch(() => null);
  const metricsPromise = newsletterContextPromise.then((context) =>
    context
      ? computeWeeklyFamilyHighlightMetrics({
          familyId,
          recipientUids: context.activeMemberUids,
          window,
        }).catch(() => null)
      : null,
  );
  const [familyDoc, memberDocs, choreDocs, newsletterContext, metrics, newsletterSendDocs] = await Promise.all([
    adminGetDocument(`families/${familyId}`).catch(() => null),
    adminListDocuments(`families/${familyId}/members`, 250).catch(() => []),
    adminListAllDocuments(`families/${familyId}/chores`, { cap: 5000 }).catch(() => []),
    newsletterContextPromise,
    metricsPromise,
    adminListAllDocuments(`families/${familyId}/newsletterSends`, { cap: 2000 }).catch(() => []),
  ]);

  if (!familyDoc || !newsletterContext || !metrics) {
    return null;
  }

  const rawMembers = memberDocs
    .map((doc) => ({
      id: documentIdFromName(doc.name),
      uid: readString(doc.fields, "uid"),
      email: readString(doc.fields, "email"),
      name: readString(doc.fields, "name") || "Unnamed member",
      role: readString(doc.fields, "role") || "player",
      status: readString(doc.fields, "status") || "unknown",
      joinedAt: readTimestamp(doc.fields, "createdAt") || readTimestamp(doc.fields, "updatedAt"),
      deleted: readBoolean(doc.fields, "deleted"),
    }))
    .filter((member) => !member.deleted);

  const emailsWithUid = new Set(
    rawMembers
      .filter((member) => Boolean(member.uid))
      .map((member) => normalizeEmail(member.email))
      .filter(Boolean),
  );

  const members = rawMembers.filter((member) => {
    if (member.uid) {
      return true;
    }
    const email = normalizeEmail(member.email);
    return !email || !emailsWithUid.has(email);
  });

  const createdByUid = readString(familyDoc.fields, "createdBy");
  const [memberUserDocs, createdByUserDoc] = await Promise.all([
    Promise.all(
      members
        .map((member) => member.uid)
        .filter(Boolean)
        .map((uid) => adminGetDocument(`users/${uid}`).catch(() => null)),
    ),
    createdByUid ? adminGetDocument(`users/${createdByUid}`).catch(() => null) : Promise.resolve(null),
  ]);

  const userByUid = new Map(
    [...memberUserDocs, createdByUserDoc].filter(Boolean).map((doc) => {
      const resolvedDoc = doc!;
      const uid = readString(resolvedDoc.fields, "uid") || documentIdFromName(resolvedDoc.name);
      return [
        uid,
        {
          email: readString(resolvedDoc.fields, "email"),
          walletBalance: readInteger(resolvedDoc.fields, "walletBalance"),
          lastSignInAt: readTimestamp(resolvedDoc.fields, "lastSignInAt"),
        },
      ] as const;
    }),
  );

  const memberById = new Map(members.map((member) => [member.id, member] as const));
  const canonicalByEmail = new Map(
    members
      .map((member) => [normalizeEmail(member.email), member.id] as const)
      .filter(([email]) => Boolean(email)),
  );
  const allMemberIds = members.map((member) => member.id);
  const assigneeAliasToMemberId = new Map<string, string>();
  for (const member of members) {
    assigneeAliasToMemberId.set(member.id, member.id);
    if (member.uid) {
      assigneeAliasToMemberId.set(member.uid, member.id);
    }
    const email = normalizeEmail(member.email);
    if (email) {
      assigneeAliasToMemberId.set(email, member.id);
    }
  }
  for (const member of rawMembers) {
    const email = normalizeEmail(member.email);
    if (!email || assigneeAliasToMemberId.has(member.id)) {
      continue;
    }
    const canonicalId = canonicalByEmail.get(email);
    if (canonicalId) {
      assigneeAliasToMemberId.set(member.id, canonicalId);
    }
  }

  function resolveCountedMemberIds(fields: Parameters<typeof readString>[0]): string[] {
    if (readString(fields, "assigneeScope") === "family") {
      return allMemberIds;
    }
    const aliases = readStringArray(fields, "assigneeIds");
    const fallbackAssigneeId = readString(fields, "assigneeId");
    const rawAliases = aliases.length > 0 ? aliases : fallbackAssigneeId ? [fallbackAssigneeId] : [];
    const seen = new Set<string>();
    const resolved: string[] = [];
    for (const alias of rawAliases) {
      const memberId = assigneeAliasToMemberId.get(alias) ?? assigneeAliasToMemberId.get(normalizeEmail(alias));
      if (memberId && memberById.has(memberId) && !seen.has(memberId)) {
        seen.add(memberId);
        resolved.push(memberId);
      }
    }
    return resolved;
  }

  const weeklyCompletedByMemberId = new Map<string, number>();
  for (const choreDoc of choreDocs) {
    if (readBoolean(choreDoc.fields, "deleted")) {
      continue;
    }
    const status = readString(choreDoc.fields, "status");
    if (status !== "Submitted" && status !== "Approved") {
      continue;
    }
    const completedAt = readTimestamp(choreDoc.fields, "submittedAt") || readTimestamp(choreDoc.fields, "updatedAt");
    if (!isWithinWindow(completedAt, window)) {
      continue;
    }
    for (const memberId of resolveCountedMemberIds(choreDoc.fields)) {
      weeklyCompletedByMemberId.set(memberId, (weeklyCompletedByMemberId.get(memberId) ?? 0) + 1);
    }
  }

  let lastWeeklyHighlightSentAt = "";
  for (const doc of newsletterSendDocs) {
    if (readString(doc.fields, "status") !== "sent") {
      continue;
    }
    const sentAt = readTimestamp(doc.fields, "sentAt");
    if (sentAt && (!lastWeeklyHighlightSentAt || Date.parse(sentAt) > Date.parse(lastWeeklyHighlightSentAt))) {
      lastWeeklyHighlightSentAt = sentAt;
    }
  }

  const overviewMembers = members
    .map((member) => {
      const user = member.uid ? userByUid.get(member.uid) : null;
      return {
        id: member.id,
        uid: member.uid || "",
        name: member.name,
        email: user?.email || member.email,
        role: member.role,
        status: member.status,
        joinedAt: member.joinedAt,
        walletBalance: user?.walletBalance ?? 0,
        lastSignInAt: user?.lastSignInAt ?? "",
        weeklyCompletedChores: weeklyCompletedByMemberId.get(member.id) ?? 0,
      };
    })
    .sort((left, right) => {
      if (right.weeklyCompletedChores !== left.weeklyCompletedChores) {
        return right.weeklyCompletedChores - left.weeklyCompletedChores;
      }
      if (left.role !== right.role) {
        return left.role.localeCompare(right.role);
      }
      return left.name.localeCompare(right.name);
    });

  return {
    family: {
      id: familyId,
      name: readString(familyDoc.fields, "name") || newsletterContext.familyName || "Family",
      createdAt: readTimestamp(familyDoc.fields, "createdAt"),
      createdBy: readString(familyDoc.fields, "createdBy"),
      createdByEmail:
        userByUid.get(readString(familyDoc.fields, "createdBy"))?.email || "",
      defaultLocale: readString(familyDoc.fields, "defaultLocale"),
      lastWeeklyHighlightSentAt,
      totalMembers: overviewMembers.length,
      activeMembers: overviewMembers.filter((member) => member.status === "active").length,
      adminCount: overviewMembers.filter((member) => member.role === "admin").length,
    },
    weeklyWindow: {
      start: window.weekStartDateOnly,
      end: window.weekEndDateOnly,
    },
    metrics,
    members: overviewMembers,
  };
}
