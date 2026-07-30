import { DEFAULT_LOCALE, resolveLocalePreference } from "@packages/locales";
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
import type {
  NewsletterRecipient,
  WeeklyFamilyHighlightMetrics,
  WeeklyWindow,
} from "@/lib/newsletters/types";
import { resolveWeeklyFamilyHighlightsEmailPreference } from "@/lib/newsletters/preferences";
import { isIsoWithinWindow } from "@/lib/newsletters/window";
import {
  FEED_FALLBACK_EMOJI,
  feedTypeEmoji,
  mapNotificationKindToFeedType,
} from "@/lib/feed/feed-events";

type FamilyContext = {
  familyId: string;
  familyName: string;
  familyLocale: ReturnType<typeof resolveLocalePreference>;
  recipients: NewsletterRecipient[];
  activeMemberUids: string[];
};

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function activityTitle(fields: Parameters<typeof readString>[0]) {
  return readString(fields, "title") || readString(fields, "kind") || "Activity";
}

export async function loadNewsletterFamilyContext(familyId: string): Promise<FamilyContext> {
  const [familyDoc, memberDocs] = await Promise.all([
    adminGetDocument(`families/${familyId}`),
    adminListDocuments(`families/${familyId}/members`, 250),
  ]);
  const familyLocale = resolveLocalePreference({
    familyLocale: readString(familyDoc.fields, "defaultLocale"),
  });
  const familyName = readString(familyDoc.fields, "name") || "Family";

  const recipients: NewsletterRecipient[] = [];
  const activeMemberUids = new Set<string>();
  for (const memberDoc of memberDocs) {
    if (readBoolean(memberDoc.fields, "deleted")) {
      continue;
    }
    if (readString(memberDoc.fields, "status") === "active") {
      const activeUid = readString(memberDoc.fields, "uid") || documentIdFromName(memberDoc.name);
      if (activeUid) {
        activeMemberUids.add(activeUid);
      }
    }
    if (readString(memberDoc.fields, "role") !== "admin") {
      continue;
    }
    if (readString(memberDoc.fields, "status") !== "active") {
      continue;
    }
    const uid = readString(memberDoc.fields, "uid") || documentIdFromName(memberDoc.name);
    if (!uid) {
      continue;
    }
    let userDoc;
    try {
      userDoc = await adminGetDocument(`users/${uid}`);
    } catch {
      userDoc = null;
    }
    const userEmail = userDoc ? readString(userDoc.fields, "email") : "";
    const memberEmail = readString(memberDoc.fields, "email");
    const email = (userEmail || memberEmail).trim();
    const locale = resolveLocalePreference({
      requestedLocale:
        (userDoc ? readString(userDoc.fields, "locale") : "") ||
        readString(memberDoc.fields, "locale"),
      familyLocale,
    });
    recipients.push({
      uid,
      email,
      locale,
      name:
        (userDoc ? readString(userDoc.fields, "name") : "") ||
        readString(memberDoc.fields, "name") ||
        email ||
        "Parent",
      optedIn: resolveWeeklyFamilyHighlightsEmailPreference(userDoc?.fields),
    });
  }

  return {
    familyId,
    familyName,
    familyLocale: familyLocale || DEFAULT_LOCALE,
    recipients,
    activeMemberUids: [...activeMemberUids],
  };
}

export function getRecipientSkipReason(recipient: NewsletterRecipient) {
  if (!recipient.email || !isValidEmail(recipient.email)) {
    return "invalid_email" as const;
  }
  if (!recipient.optedIn) {
    return "opt_out" as const;
  }
  return "";
}

export async function computeWeeklyFamilyHighlightMetrics(input: {
  familyId: string;
  recipientUids: string[];
  window: WeeklyWindow;
}): Promise<WeeklyFamilyHighlightMetrics> {
  // chores/awardClaims grow unbounded (recurring chores spawn a doc each cycle),
  // so they must page past the 300-doc REST cap or the recap under-counts.
  // members is capped at 100 per family, so a single page is always complete.
  const [choreDocs, notificationDocs, awardClaimDocs, memberDocs] = await Promise.all([
    adminListAllDocuments(`families/${input.familyId}/chores`),
    adminListAllDocuments(`families/${input.familyId}/notifications`),
    adminListAllDocuments(`families/${input.familyId}/awardClaims`),
    adminListDocuments(`families/${input.familyId}/members`, 250),
  ]);

  // Mirror the dashboard's completion-stats attribution so the "most active
  // helper" tally matches the dashboard leaderboard. A chore credits a single
  // member (`assigneeId`), several members (`assigneeIds`), or the whole family
  // (`assigneeScope === "family"`); counting only `assigneeId` drops every
  // group/family completion for all but the lone single-assignee member.
  const rawMembers = memberDocs
    .map((doc) => ({
      id: documentIdFromName(doc.name),
      uid: readString(doc.fields, "uid") || undefined,
      email: readString(doc.fields, "email"),
      name: readString(doc.fields, "name") || "Unnamed member",
      avatarId: readString(doc.fields, "avatarId"),
      avatarPhotoUrl: readString(doc.fields, "avatarPhotoUrl"),
      dashboardPrimaryColor: readString(doc.fields, "dashboardPrimaryColor"),
      deleted: readBoolean(doc.fields, "deleted"),
    }))
    .filter((member) => !member.deleted);
  const normalizeEmail = (value: string) => value.trim().toLowerCase();
  const emailsWithUid = new Set(
    rawMembers
      .filter((member) => Boolean(member.uid))
      .map((member) => normalizeEmail(member.email))
      .filter(Boolean),
  );
  // Drop email-only invite docs that are superseded by an accepted uid doc so a
  // single person is not double-counted under two member ids.
  const members = rawMembers.filter((member) => {
    if (member.uid) {
      return true;
    }
    const email = normalizeEmail(member.email);
    return !email || !emailsWithUid.has(email);
  });
  const memberById = new Map(members.map((member) => [member.id, member] as const));
  const allMemberIds = members.map((member) => member.id);
  const canonicalByEmail = new Map(
    members
      .map((member) => [normalizeEmail(member.email), member.id] as const)
      .filter(([email]) => Boolean(email)),
  );
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

  function resolveCountedMemberIds(
    fields: Parameters<typeof readString>[0],
  ): string[] {
    if (readString(fields, "assigneeScope") === "family") {
      return allMemberIds;
    }
    const assigneeIdsRaw = readStringArray(fields, "assigneeIds");
    const singleAssigneeId = readString(fields, "assigneeId");
    const aliases =
      assigneeIdsRaw.length > 0
        ? assigneeIdsRaw
        : singleAssigneeId
          ? [singleAssigneeId]
          : [];
    const resolved: string[] = [];
    const seen = new Set<string>();
    for (const alias of aliases) {
      const memberId =
        assigneeAliasToMemberId.get(alias) ??
        assigneeAliasToMemberId.get(normalizeEmail(alias)) ??
        alias;
      if (memberById.has(memberId) && !seen.has(memberId)) {
        seen.add(memberId);
        resolved.push(memberId);
      }
    }
    return resolved;
  }

  const completedCounts = new Map<string, number>();
  let choresCompleted = 0;
  let pendingApprovals = 0;

  for (const choreDoc of choreDocs) {
    if (readBoolean(choreDoc.fields, "deleted")) {
      continue;
    }
    const status = readString(choreDoc.fields, "status");
    // Match the dashboard Approval Inbox exactly: Submitted is also the
    // completed state for chores that pay out immediately, so it only
    // represents a pending approval when the chore requires approval.
    if (status === "Submitted" && readBoolean(choreDoc.fields, "requireApproval")) {
      pendingApprovals += 1;
    }
    if (status !== "Submitted" && status !== "Approved") {
      continue;
    }
    const completedAt = readTimestamp(choreDoc.fields, "submittedAt") || readTimestamp(choreDoc.fields, "updatedAt");
    if (!isIsoWithinWindow(completedAt, input.window)) {
      continue;
    }
    choresCompleted += 1;
    for (const memberId of resolveCountedMemberIds(choreDoc.fields)) {
      completedCounts.set(memberId, (completedCounts.get(memberId) ?? 0) + 1);
    }
  }

  let mostActiveHelperName = "";
  let mostActiveHelperCount = 0;
  let mostActiveHelperAvatarId = "";
  let mostActiveHelperAvatarPhotoUrl = "";
  let mostActiveHelperPrimaryColor = "";
  for (const [memberId, count] of completedCounts) {
    if (count <= mostActiveHelperCount) {
      continue;
    }
    mostActiveHelperCount = count;
    const member = memberById.get(memberId);
    mostActiveHelperName = member?.name || memberId;
    mostActiveHelperAvatarId = member?.avatarId ?? "";
    mostActiveHelperAvatarPhotoUrl = member?.avatarPhotoUrl ?? "";
    mostActiveHelperPrimaryColor = member?.dashboardPrimaryColor ?? "";
  }

  let rewardsRedeemed = 0;
  let familyAwardsClaimed = 0;
  for (const awardClaimDoc of awardClaimDocs) {
    if (readBoolean(awardClaimDoc.fields, "deleted")) {
      continue;
    }
    if (isIsoWithinWindow(readTimestamp(awardClaimDoc.fields, "purchasedAt"), input.window)) {
      rewardsRedeemed += 1;
    }
    if (
      readString(awardClaimDoc.fields, "status") === "claimed" &&
      isIsoWithinWindow(readTimestamp(awardClaimDoc.fields, "claimedAt"), input.window)
    ) {
      familyAwardsClaimed += 1;
    }
  }

  let coinsEarned = 0;
  let questsCompleted = 0;
  let achievementsUnlocked = 0;
  await Promise.all(
    input.recipientUids.map(async (uid) => {
      const [ledgerDocs, questDocs, achievementDocs] = await Promise.all([
        adminListAllDocuments(`users/${uid}/walletLedger`).catch(() => []),
        adminListAllDocuments(`users/${uid}/questProgress`).catch(() => []),
        adminListAllDocuments(`users/${uid}/achievements`).catch(() => []),
      ]);
      for (const ledgerDoc of ledgerDocs) {
        if (!readBoolean(ledgerDoc.fields, "countsTowardBalance")) {
          continue;
        }
        if (!isIsoWithinWindow(readTimestamp(ledgerDoc.fields, "createdAt"), input.window)) {
          continue;
        }
        const delta = readInteger(ledgerDoc.fields, "delta");
        if (delta > 0) {
          coinsEarned += delta;
        }
      }
      for (const questDoc of questDocs) {
        if (readString(questDoc.fields, "status") !== "completed") {
          continue;
        }
        if (isIsoWithinWindow(readTimestamp(questDoc.fields, "completedAt"), input.window)) {
          questsCompleted += 1;
        }
      }
      for (const achievementDoc of achievementDocs) {
        if (!readBoolean(achievementDoc.fields, "completed")) {
          continue;
        }
        if (isIsoWithinWindow(readTimestamp(achievementDoc.fields, "completedAt"), input.window)) {
          achievementsUnlocked += 1;
        }
      }
    }),
  );

  const recentHighlights = notificationDocs
    .filter((doc) => isIsoWithinWindow(readTimestamp(doc.fields, "createdAt"), input.window))
    .sort((left, right) => {
      const leftMillis = Date.parse(readTimestamp(left.fields, "createdAt")) || 0;
      const rightMillis = Date.parse(readTimestamp(right.fields, "createdAt")) || 0;
      return rightMillis - leftMillis;
    })
    .slice(0, 5)
    .map((doc) => {
      const feedType = mapNotificationKindToFeedType(readString(doc.fields, "kind"));
      return {
        id: documentIdFromName(doc.name),
        title: activityTitle(doc.fields),
        message: readString(doc.fields, "message"),
        createdAt: readTimestamp(doc.fields, "createdAt"),
        icon: feedType ? feedTypeEmoji(feedType) : FEED_FALLBACK_EMOJI,
      };
    });

  const hasActivity =
    choresCompleted > 0 ||
    coinsEarned > 0 ||
    rewardsRedeemed > 0 ||
    familyAwardsClaimed > 0 ||
    questsCompleted > 0 ||
    achievementsUnlocked > 0 ||
    pendingApprovals > 0 ||
    recentHighlights.length > 0;

  return {
    choresCompleted,
    coinsEarned,
    rewardsRedeemed,
    familyAwardsClaimed,
    questsCompleted,
    achievementsUnlocked,
    pendingApprovals,
    mostActiveHelperName,
    mostActiveHelperCount,
    mostActiveHelperAvatarId,
    mostActiveHelperAvatarPhotoUrl,
    mostActiveHelperPrimaryColor,
    recentHighlights,
    hasActivity,
  };
}
