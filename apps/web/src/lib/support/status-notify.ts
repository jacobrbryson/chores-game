import { randomUUID } from "node:crypto";
import { getCanonicalAppOrigin } from "@/lib/app-origin";
import {
  getEmailProvider,
  getEmailReplyToAddresses,
} from "@/lib/email/provider";
import { adminCreateOrReplaceDocument } from "@/lib/firestore/admin";
import {
  stringArrayField,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";
import type { SupportRequestStatus, SupportRequestType } from "@/lib/support/requests";

// Human-readable status labels for reporter notifications. Emails/in-app copy
// here are intentionally English-only for now; localizing operator-triggered
// reporter messages is a follow-up.
const STATUS_LABEL: Record<SupportRequestStatus, string> = {
  new: "New",
  needs_info: "Needs Info",
  triaged: "Triaged",
  planned: "Planned",
  in_progress: "In Progress",
  released: "Released",
  done: "Done",
  closed: "Closed",
  declined: "Declined",
  duplicate: "Duplicate",
  cancelled: "Cancelled",
};

export type StatusChangeNotifyInput = {
  familyId: string;
  requestId: string;
  type: SupportRequestType;
  subject: string;
  reporterUid: string;
  reporterEmail: string;
  previousStatus: SupportRequestStatus;
  nextStatus: SupportRequestStatus;
  // Optional operator-authored public message shown to the reporter.
  publicMessage: string;
};

function statusLabel(status: SupportRequestStatus) {
  return STATUS_LABEL[status] ?? status;
}

function buildSummaryLine(input: StatusChangeNotifyInput) {
  return `Your ${input.type} "${input.subject}" is now ${statusLabel(input.nextStatus)}.`;
}

// Best-effort in-app notification visible to the reporter. Uses admin creds since
// the operator changing status is a support admin, not a member of the family.
async function writeInAppNotification(input: StatusChangeNotifyInput) {
  const now = new Date().toISOString();
  const message = input.publicMessage
    ? `${buildSummaryLine(input)} ${input.publicMessage}`
    : buildSummaryLine(input);
  await adminCreateOrReplaceDocument(`families/${input.familyId}/notifications/${randomUUID()}`, {
    familyId: stringField(input.familyId),
    kind: stringField("support_request_status_changed"),
    actorUid: stringField(""),
    actorEmail: stringField(""),
    actorName: stringField("Family Chores Support"),
    title: stringField(buildSummaryLine(input).slice(0, 180)),
    message: stringField(message.slice(0, 600)),
    choreId: stringField(""),
    choreTitle: stringField(""),
    // relatedIds gates per-user visibility for players; include the reporter so
    // the update surfaces in their notifications feed.
    relatedIds: stringArrayField(
      [input.reporterUid, input.reporterEmail].map((v) => v.trim().toLowerCase()).filter(Boolean),
    ),
    requestId: stringField(input.requestId),
    createdAt: timestampField(now),
  });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sendReporterEmail(input: StatusChangeNotifyInput) {
  if (!input.reporterEmail) {
    return;
  }
  const provider = getEmailProvider();
  const origin = getCanonicalAppOrigin();
  const summary = buildSummaryLine(input);
  const link = `${origin}/support`;

  const textLines = [
    summary,
    "",
    `Previous status: ${statusLabel(input.previousStatus)}`,
    `New status: ${statusLabel(input.nextStatus)}`,
  ];
  if (input.publicMessage) {
    textLines.push("", input.publicMessage);
  }
  textLines.push("", `View your requests: ${link}`);

  const html = `<!doctype html><html><body style="font-family:system-ui,-apple-system,sans-serif;color:#0f172a;">
  <p style="font-size:16px;margin:0 0 12px;">${escapeHtml(summary)}</p>
  ${input.publicMessage ? `<p style="white-space:pre-wrap;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;">${escapeHtml(input.publicMessage)}</p>` : ""}
  <p style="margin-top:16px;"><a href="${escapeHtml(link)}" style="color:#2563eb;">View your requests &rarr;</a></p>
  </body></html>`;

  await provider.send({
    to: [input.reporterEmail],
    subject: `Update on your ${input.type}: ${input.subject}`.slice(0, 200),
    html,
    text: textLines.join("\n"),
    replyTo: getEmailReplyToAddresses().length > 0 ? getEmailReplyToAddresses() : undefined,
  });
}

// Notifies the reporter of a status change through in-app + email channels.
// Entirely best-effort: any failure is logged and swallowed so it never blocks
// the operator's status update.
export async function notifyReporterOfStatusChange(input: StatusChangeNotifyInput) {
  if (!input.reporterUid && !input.reporterEmail) {
    return;
  }
  await writeInAppNotification(input).catch((error) => {
    const reason = error instanceof Error ? error.message : "unknown";
    console.warn("[SUPPORT_STATUS_INAPP_NOTIFY_SKIPPED]", reason.slice(0, 180));
  });
  await sendReporterEmail(input).catch((error) => {
    const reason = error instanceof Error ? error.message : "unknown";
    console.warn("[SUPPORT_STATUS_EMAIL_SKIPPED]", reason.slice(0, 180));
  });
}
