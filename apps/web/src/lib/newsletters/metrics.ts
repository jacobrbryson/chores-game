import { DEFAULT_LOCALE, resolveLocalePreference } from "@packages/locales";
import { adminGetDocument, adminListDocuments } from "@/lib/firestore/admin";
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
  const [choreDocs, notificationDocs, awardClaimDocs] = await Promise.all([
    adminListDocuments(`families/${input.familyId}/chores`, 2000),
    adminListDocuments(`families/${input.familyId}/notifications`, 500),
    adminListDocuments(`families/${input.familyId}/awardClaims`, 500),
  ]);

  const completedCounts = new Map<string, number>();
  let choresCompleted = 0;
  let pendingApprovals = 0;

  for (const choreDoc of choreDocs) {
    if (readBoolean(choreDoc.fields, "deleted")) {
      continue;
    }
    const status = readString(choreDoc.fields, "status");
    if (status === "Submitted") {
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
    const assigneeId = readString(choreDoc.fields, "assigneeId");
    if (assigneeId) {
      completedCounts.set(assigneeId, (completedCounts.get(assigneeId) ?? 0) + 1);
    }
  }

  let mostActiveHelperName = "";
  let mostActiveHelperCount = 0;
  for (const [assigneeId, count] of completedCounts) {
    if (count <= mostActiveHelperCount) {
      continue;
    }
    mostActiveHelperCount = count;
    try {
      const memberDoc = await adminGetDocument(`families/${input.familyId}/members/${assigneeId}`);
      mostActiveHelperName = readString(memberDoc.fields, "name") || assigneeId;
    } catch {
      mostActiveHelperName = assigneeId;
    }
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
        adminListDocuments(`users/${uid}/walletLedger`, 500).catch(() => []),
        adminListDocuments(`users/${uid}/questProgress`, 300).catch(() => []),
        adminListDocuments(`users/${uid}/achievements`, 300).catch(() => []),
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
    .map((doc) => ({
      id: documentIdFromName(doc.name),
      title: activityTitle(doc.fields),
      message: readString(doc.fields, "message"),
      createdAt: readTimestamp(doc.fields, "createdAt"),
    }));

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
    recentHighlights,
    hasActivity,
  };
}
