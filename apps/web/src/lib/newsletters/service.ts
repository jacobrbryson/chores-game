import { createTranslator, normalizeLocale } from "@packages/locales";
import { getCanonicalAppOrigin } from "@/lib/app-origin";
import { type EmailProvider, getEmailProvider, getEmailReplyToAddresses } from "@/lib/email/provider";
import { renderEmailTemplate } from "@/lib/email/templates";
import {
  adminCreateOrReplaceDocument,
  adminGetDocument,
  adminListDocuments,
  adminRunQuery,
} from "@/lib/firestore/admin";
import {
  documentIdFromName,
  readString,
  readTimestamp,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";
import {
  computeWeeklyFamilyHighlightMetrics,
  getRecipientSkipReason,
  loadNewsletterFamilyContext,
} from "@/lib/newsletters/metrics";
import type {
  NewsletterRecipient,
  NewsletterSendRecord,
  NewsletterSendStatus,
  WeeklyWindow,
} from "@/lib/newsletters/types";
import { getPreviousWeeklyWindow } from "@/lib/newsletters/window";
import { resolveAvatarSrc } from "@/lib/avatar/resolve";
import { resolveMemberPrimaryColor } from "@/lib/theme/member-primary-color";
import { getChangeLogEntries } from "@/lib/change-log";

function formatDateLabel(iso: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));
}

function sanitizeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "unknown";
  return message.slice(0, 240);
}

function buildSendId(weekStartDateOnly: string, recipientUid: string) {
  return `weekly_${weekStartDateOnly}_${recipientUid}`;
}

function resolveHelperAvatarUrl(input: {
  appOrigin: string;
  avatarId: string;
  avatarPhotoUrl: string;
}) {
  // Reuse the same resolution the in-app <Avatar /> uses, then absolutize the
  // preset path (`/avatars/default/...`) since email clients can't load relative URLs.
  const src = resolveAvatarSrc(input.avatarId, input.avatarPhotoUrl);
  return src.startsWith("/") ? `${input.appOrigin}${src}` : src;
}

function buildProTip(input: {
  locale: NewsletterRecipient["locale"];
  familyLocale: NewsletterRecipient["locale"];
  pendingApprovals: number;
  choresCompleted: number;
}) {
  const t = createTranslator({
    locale: input.locale,
    familyLocale: input.familyLocale,
  });
  if (input.pendingApprovals > 0) {
    return t("newsletter.weekly.tips.pendingApprovals");
  }
  if (input.choresCompleted === 0) {
    return t("newsletter.weekly.tips.kickstart");
  }
  return t("newsletter.weekly.tips.praise");
}

function sendRecordFields(record: NewsletterSendRecord) {
  return {
    id: stringField(record.id),
    familyId: stringField(record.familyId),
    weekStart: timestampField(record.weekStart),
    weekEnd: timestampField(record.weekEnd),
    recipientUid: stringField(record.recipientUid),
    recipientEmail: stringField(record.recipientEmail),
    recipientLocale: stringField(record.recipientLocale),
    status: stringField(record.status),
    skippedReason: stringField(record.skippedReason),
    provider: stringField(record.provider),
    providerMessageId: stringField(record.providerMessageId),
    errorMessage: stringField(record.errorMessage),
    createdAt: timestampField(record.createdAt),
    sentAt: record.sentAt ? timestampField(record.sentAt) : stringField(""),
    updatedAt: timestampField(record.updatedAt),
  };
}

async function readExistingSendRecord(familyId: string, sendId: string) {
  try {
    const doc = await adminGetDocument(`families/${familyId}/newsletterSends/${sendId}`);
    return {
      id: documentIdFromName(doc.name),
      familyId: readString(doc.fields, "familyId"),
      weekStart: readTimestamp(doc.fields, "weekStart"),
      weekEnd: readTimestamp(doc.fields, "weekEnd"),
      recipientUid: readString(doc.fields, "recipientUid"),
      recipientEmail: readString(doc.fields, "recipientEmail"),
      recipientLocale: normalizeLocale(readString(doc.fields, "recipientLocale")) || "en-US",
      status: readString(doc.fields, "status") as NewsletterSendStatus,
      skippedReason: readString(doc.fields, "skippedReason"),
      provider: readString(doc.fields, "provider"),
      providerMessageId: readString(doc.fields, "providerMessageId"),
      errorMessage: readString(doc.fields, "errorMessage"),
      createdAt: readTimestamp(doc.fields, "createdAt"),
      sentAt: readTimestamp(doc.fields, "sentAt"),
      updatedAt: readTimestamp(doc.fields, "updatedAt"),
    } satisfies NewsletterSendRecord;
  } catch (error) {
    const reason = sanitizeErrorMessage(error);
    if (reason.includes("FIRESTORE_ADMIN_HTTP_404")) {
      return null;
    }
    throw error;
  }
}

async function writeSendRecord(record: NewsletterSendRecord) {
  await adminCreateOrReplaceDocument(
    `families/${record.familyId}/newsletterSends/${record.id}`,
    sendRecordFields(record),
  );
}

export async function buildWeeklyFamilyHighlightsPreview(input: {
  familyId: string;
  recipientLocale?: NewsletterRecipient["locale"];
  window?: WeeklyWindow;
}) {
  const window = input.window ?? getPreviousWeeklyWindow();
  const family = await loadNewsletterFamilyContext(input.familyId);
  const metrics = await computeWeeklyFamilyHighlightMetrics({
    familyId: family.familyId,
    recipientUids: family.activeMemberUids,
    window,
  });
  const locale = input.recipientLocale ?? family.recipients[0]?.locale ?? family.familyLocale;
  const appOrigin = getCanonicalAppOrigin();
  // New features shipped within the same window the recap covers.
  const recentEnhancements = getChangeLogEntries()
    .filter(
      (entry) =>
        entry.type === "Feature" &&
        entry.date >= window.weekStartDateOnly &&
        entry.date <= window.weekEndDateOnly,
    )
    .map((entry) => ({ title: entry.subject, description: entry.description }));
  const rendered = renderEmailTemplate({
    templateId: "weekly-family-highlights",
    locale,
    familyLocale: family.familyLocale,
    props: {
      appName: "Family Chores",
      senderIdentity: "Family Chores",
      familyName: family.familyName,
      weekStartLabel: formatDateLabel(window.weekStart, locale),
      weekEndLabel: formatDateLabel(window.weekEnd, locale),
      dashboardUrl: `${appOrigin}/`,
      managePreferencesUrl: `${appOrigin}/profile?tab=notifications#newsletter-preferences`,
      choresCompleted: metrics.choresCompleted,
      coinsEarned: metrics.coinsEarned,
      rewardsRedeemed: metrics.rewardsRedeemed,
      familyAwardsClaimed: metrics.familyAwardsClaimed,
      questsCompleted: metrics.questsCompleted,
      achievementsUnlocked: metrics.achievementsUnlocked,
      pendingApprovals: metrics.pendingApprovals,
      mostActiveHelperName: metrics.mostActiveHelperName,
      mostActiveHelperCount: metrics.mostActiveHelperCount,
      mostActiveHelperAvatarUrl: resolveHelperAvatarUrl({
        appOrigin,
        avatarId: metrics.mostActiveHelperAvatarId,
        avatarPhotoUrl: metrics.mostActiveHelperAvatarPhotoUrl,
      }),
      mostActiveHelperAvatarColor: resolveMemberPrimaryColor(metrics.mostActiveHelperPrimaryColor),
      recentHighlights: metrics.recentHighlights,
      recentEnhancements,
      proTip: buildProTip({
        locale,
        familyLocale: family.familyLocale,
        pendingApprovals: metrics.pendingApprovals,
        choresCompleted: metrics.choresCompleted,
      }),
    },
  });
  return {
    family,
    metrics,
    window,
    rendered,
  };
}

export async function sendWeeklyFamilyHighlightsTest(input: {
  familyId: string;
  recipientEmail: string;
  recipientLocale: NewsletterRecipient["locale"];
}) {
  const preview = await buildWeeklyFamilyHighlightsPreview({
    familyId: input.familyId,
    recipientLocale: input.recipientLocale,
  });
  const provider = getEmailProvider();
  const result = await provider.send({
    to: [input.recipientEmail],
    subject: preview.rendered.subject,
    html: preview.rendered.html,
    text: preview.rendered.text,
    replyTo: getEmailReplyToAddresses(),
  });
  return {
    provider: result.provider,
    providerMessageId: result.messageId,
    preview,
  };
}

type WeeklySendRecordSummary = Pick<
  NewsletterSendRecord,
  "familyId" | "id" | "recipientUid" | "recipientEmail" | "status" | "skippedReason" | "errorMessage" | "provider" | "providerMessageId"
>;

type WeeklySendOutcome = {
  sent: number;
  skipped: number;
  failed: number;
  records: WeeklySendRecordSummary[];
  // Most recent successful send timestamp in this run, used by callers (e.g. the support
  // console) to refresh the "Weekly Highlights sent" column without a full reload.
  lastSentAt: string;
};

async function sendWeeklyHighlightsToFamily(input: {
  familyId: string;
  window: WeeklyWindow;
  provider: EmailProvider;
  replyTo: string[];
  outcome: WeeklySendOutcome;
}) {
  const { familyId, window, provider, replyTo, outcome } = input;
  const preview = await buildWeeklyFamilyHighlightsPreview({ familyId, window });

  for (const recipient of preview.family.recipients) {
    const sendId = buildSendId(window.weekStartDateOnly, recipient.uid);
    const now = new Date().toISOString();
    const existing = await readExistingSendRecord(familyId, sendId);
    if (existing?.status === "sent") {
      outcome.skipped += 1;
      outcome.records.push({
        familyId,
        id: sendId,
        recipientUid: recipient.uid,
        recipientEmail: recipient.email,
        status: "skipped",
        skippedReason: "duplicate_sent",
        errorMessage: "",
        provider: existing.provider,
        providerMessageId: existing.providerMessageId,
      });
      continue;
    }

    const skipReason = getRecipientSkipReason(recipient) || (!preview.metrics.hasActivity ? "no_activity" : "");
    const baseRecord: NewsletterSendRecord = {
      id: sendId,
      familyId,
      weekStart: window.weekStart,
      weekEnd: window.weekEnd,
      recipientUid: recipient.uid,
      recipientEmail: recipient.email,
      recipientLocale: recipient.locale,
      status: skipReason ? "skipped" : "pending",
      skippedReason: skipReason,
      provider: existing?.provider ?? provider.name,
      providerMessageId: "",
      errorMessage: "",
      createdAt: existing?.createdAt || now,
      sentAt: "",
      updatedAt: now,
    };

    if (skipReason) {
      await writeSendRecord(baseRecord);
      outcome.skipped += 1;
      outcome.records.push({
        familyId,
        id: sendId,
        recipientUid: recipient.uid,
        recipientEmail: recipient.email,
        status: "skipped",
        skippedReason: skipReason,
        errorMessage: "",
        provider: provider.name,
        providerMessageId: "",
      });
      continue;
    }

    await writeSendRecord(baseRecord);
    try {
      const sendResult = await provider.send({
        to: [recipient.email],
        subject: preview.rendered.subject,
        html: preview.rendered.html,
        text: preview.rendered.text,
        replyTo,
      });
      const sentRecord: NewsletterSendRecord = {
        ...baseRecord,
        status: "sent",
        provider: sendResult.provider,
        providerMessageId: sendResult.messageId,
        sentAt: now,
        updatedAt: now,
      };
      await writeSendRecord(sentRecord);
      outcome.sent += 1;
      outcome.lastSentAt = now;
      outcome.records.push({
        familyId,
        id: sendId,
        recipientUid: recipient.uid,
        recipientEmail: recipient.email,
        status: "sent",
        skippedReason: "",
        errorMessage: "",
        provider: sendResult.provider,
        providerMessageId: sendResult.messageId,
      });
    } catch (error) {
      const failedRecord: NewsletterSendRecord = {
        ...baseRecord,
        status: "failed",
        errorMessage: sanitizeErrorMessage(error),
        updatedAt: new Date().toISOString(),
      };
      await writeSendRecord(failedRecord);
      outcome.failed += 1;
      outcome.records.push({
        familyId,
        id: sendId,
        recipientUid: recipient.uid,
        recipientEmail: recipient.email,
        status: "failed",
        skippedReason: "",
        errorMessage: failedRecord.errorMessage,
        provider: provider.name,
        providerMessageId: "",
      });
    }
  }
}

export async function sendWeeklyFamilyHighlightsForFamily(input: {
  familyId: string;
  window?: WeeklyWindow;
}) {
  const window = input.window ?? getPreviousWeeklyWindow();
  const provider = getEmailProvider();
  const replyTo = getEmailReplyToAddresses();
  const outcome: WeeklySendOutcome = { sent: 0, skipped: 0, failed: 0, records: [], lastSentAt: "" };
  await sendWeeklyHighlightsToFamily({ familyId: input.familyId, window, provider, replyTo, outcome });
  return { window, ...outcome };
}

export async function sendWeeklyFamilyHighlightsForAllFamilies(input?: {
  window?: WeeklyWindow;
}) {
  const window = input?.window ?? getPreviousWeeklyWindow();
  const familyDocs = await adminListDocuments("families", 500);
  const provider = getEmailProvider();
  const replyTo = getEmailReplyToAddresses();
  const outcome: WeeklySendOutcome = { sent: 0, skipped: 0, failed: 0, records: [], lastSentAt: "" };

  for (const familyDoc of familyDocs) {
    const familyId = documentIdFromName(familyDoc.name);
    if (!familyId) {
      continue;
    }
    await sendWeeklyHighlightsToFamily({ familyId, window, provider, replyTo, outcome });
  }

  return {
    window,
    sent: outcome.sent,
    skipped: outcome.skipped,
    failed: outcome.failed,
    records: outcome.records,
  };
}

export async function loadWeeklyNewsletterSupportSummary(input?: {
  weekStartDateOnly?: string;
}) {
  const window = getPreviousWeeklyWindow();
  const weekStartDateOnly = input?.weekStartDateOnly ?? window.weekStartDateOnly;
  const docs = await adminRunQuery({
    from: [{ collectionId: "newsletterSends", allDescendants: true }],
    limit: 500,
  });
  const records = docs
    .map((doc) => ({
      id: documentIdFromName(doc.name),
      familyId: readString(doc.fields, "familyId"),
      recipientUid: readString(doc.fields, "recipientUid"),
      recipientEmail: readString(doc.fields, "recipientEmail"),
      status: readString(doc.fields, "status"),
      skippedReason: readString(doc.fields, "skippedReason"),
      provider: readString(doc.fields, "provider"),
      providerMessageId: readString(doc.fields, "providerMessageId"),
      errorMessage: readString(doc.fields, "errorMessage"),
      weekStart: readTimestamp(doc.fields, "weekStart"),
      updatedAt: readTimestamp(doc.fields, "updatedAt"),
      sentAt: readTimestamp(doc.fields, "sentAt"),
    }))
    .filter((record) => record.weekStart.startsWith(weekStartDateOnly))
    .sort((left, right) => (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0));

  const recentFailures = records.filter((record) => record.status === "failed").slice(0, 10);
  const recentRecords = records.slice(0, 20);
  const skippedReasons = records.reduce<Record<string, number>>((acc, record) => {
    if (record.status === "skipped" && record.skippedReason) {
      acc[record.skippedReason] = (acc[record.skippedReason] ?? 0) + 1;
    }
    return acc;
  }, {});

  return {
    weekStartDateOnly,
    sentThisWeek: records.filter((record) => record.status === "sent").length,
    failedThisWeek: records.filter((record) => record.status === "failed").length,
    skippedThisWeek: records.filter((record) => record.status === "skipped").length,
    optedOutRecipients: skippedReasons.opt_out ?? 0,
    familiesWithNewsletterActivity: new Set(records.map((record) => record.familyId).filter(Boolean)).size,
    skippedReasons,
    recentFailures,
    recentRecords,
  };
}
