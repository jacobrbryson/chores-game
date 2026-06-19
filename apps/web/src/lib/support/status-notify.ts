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

// Accent colors for the "new status" badge, mirroring the in-app status tones.
// Each entry is [text, background, border]. Anything unmapped falls back to slate.
const STATUS_BADGE_COLORS: Partial<Record<SupportRequestStatus, [string, string, string]>> = {
  planned: ["#3730a3", "#eef2ff", "#c7d2fe"],
  in_progress: ["#1d4ed8", "#eff6ff", "#bfdbfe"],
  released: ["#166534", "#f0fdf4", "#bbf7d0"],
  done: ["#166534", "#f0fdf4", "#bbf7d0"],
  needs_info: ["#9a3412", "#fff7ed", "#fed7aa"],
  declined: ["#9f1239", "#fff1f2", "#fecdd3"],
  duplicate: ["#9f1239", "#fff1f2", "#fecdd3"],
  cancelled: ["#9f1239", "#fff1f2", "#fecdd3"],
  closed: ["#334155", "#f1f5f9", "#e2e8f0"],
};

function renderStatusBadge(status: SupportRequestStatus) {
  const [text, background, border] = STATUS_BADGE_COLORS[status] ?? ["#334155", "#f1f5f9", "#e2e8f0"];
  return `<span style="display:inline-block;padding:4px 12px;border-radius:999px;font-size:13px;font-weight:700;color:${text};background:${background};border:1px solid ${border};">${escapeHtml(statusLabel(status))}</span>`;
}

async function sendReporterEmail(input: StatusChangeNotifyInput) {
  if (!input.reporterEmail) {
    return;
  }
  const provider = getEmailProvider();
  const origin = getCanonicalAppOrigin();
  const summary = buildSummaryLine(input);
  const link = `${origin}/support`;
  const heroImageUrl = `${origin}/emails/updated-feature.png`;
  const typeLabel = input.type.charAt(0).toUpperCase() + input.type.slice(1);

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

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a;">
    <div style="max-width:640px;margin:0 auto;padding:24px;">
      <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:20px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#0f766e,#1d4ed8);padding:28px 24px;color:#ffffff;">
          <div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;opacity:0.88;">Family Chores</div>
          <h1 style="margin:10px 0 8px;font-size:28px;line-height:1.2;">${escapeHtml(typeLabel)} update</h1>
          <p style="margin:0;font-size:16px;line-height:1.5;">${escapeHtml(summary)}</p>
        </div>
        <img src="${escapeHtml(heroImageUrl)}" width="592" alt="" style="display:block;width:100%;max-width:100%;height:auto;border:0;" />
        <div style="padding:24px;">
          <div style="padding:16px;border-radius:16px;background:#f8fafc;border:1px solid #e2e8f0;">
            <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#475569;">Status</div>
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:10px;border-collapse:collapse;"><tr>
              <td style="vertical-align:middle;color:#94a3b8;font-size:13px;text-decoration:line-through;">${escapeHtml(statusLabel(input.previousStatus))}</td>
              <td style="vertical-align:middle;padding:0 10px;color:#94a3b8;font-size:16px;">&rarr;</td>
              <td style="vertical-align:middle;">${renderStatusBadge(input.nextStatus)}</td>
            </tr></table>
          </div>
          ${input.publicMessage ? `<div style="margin-top:22px;padding:16px;border-radius:16px;background:#fff7ed;border:1px solid #fed7aa;">
            <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9a3412;">A note from the team</div>
            <p style="margin:8px 0 0;line-height:1.6;color:#7c2d12;white-space:pre-wrap;">${escapeHtml(input.publicMessage)}</p>
          </div>` : ""}
          <div style="margin-top:24px;">
            <a href="${escapeHtml(link)}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:700;">View your requests</a>
          </div>
        </div>
        <div style="padding:18px 24px;border-top:1px solid #e2e8f0;background:#f8fafc;color:#475569;font-size:13px;line-height:1.6;">
          <div>Family Chores · Support</div>
        </div>
      </div>
    </div>
  </body>
</html>`;

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
