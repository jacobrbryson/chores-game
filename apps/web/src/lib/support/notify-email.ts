import { getCanonicalAppOrigin } from "@/lib/app-origin";
import {
  getEmailProvider,
  getEmailReplyToAddresses,
  type EmailSendPayload,
} from "@/lib/email/provider";
import type {
  SupportRequestDiagnostics,
  SupportRequestImportance,
  SupportRequestSeverity,
  SupportRequestType,
} from "@/lib/support/requests";

// Inbox that receives every new feedback submission (Phase 4). Overridable so
// staging can route elsewhere; defaults to the production support address.
export const DEFAULT_SUPPORT_INBOX = "developers@orcwood.com";

export function getSupportInboxAddress() {
  return process.env.SUPPORT_INBOX_ADDRESS?.trim() || DEFAULT_SUPPORT_INBOX;
}

const TYPE_TAG: Record<SupportRequestType, string> = {
  bug: "BUG",
  feature: "FEATURE",
  question: "QUESTION",
  feedback: "FEEDBACK",
};

export type SupportEmailRequest = {
  id: string;
  familyId: string;
  familyName?: string;
  type: SupportRequestType;
  status: string;
  subject: string;
  description: string;
  severity: SupportRequestSeverity | null;
  importance: SupportRequestImportance | null;
  category: string;
  createdByUid: string;
  createdByDisplayName: string;
  createdByEmail: string;
  allowContact: boolean;
  notifyOnStatusChange: boolean;
  pageUrl: string;
  userAgent: string;
  diagnostics: SupportRequestDiagnostics;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildSupportEmailSubject(request: SupportEmailRequest) {
  const tag = TYPE_TAG[request.type] ?? "FEEDBACK";
  return `[${tag}] ${request.subject}`.slice(0, 200);
}

function detailUrl(request: SupportEmailRequest) {
  const origin = getCanonicalAppOrigin();
  const params = new URLSearchParams({ focus: request.id, familyId: request.familyId });
  return `${origin}/support/requests?${params.toString()}`;
}

// Plain-text + HTML rows shown in the operator email. Kept simple and readable;
// the goal is fast triage, not a polished marketing template.
function buildRows(request: SupportEmailRequest): Array<[string, string]> {
  const grade = request.type === "bug" ? request.severity ?? "—" : request.importance ?? "—";
  const gradeLabel = request.type === "bug" ? "Severity" : "Importance";
  const rows: Array<[string, string]> = [
    ["Type", request.type],
    ["Status", request.status],
    [gradeLabel, grade],
    ["Category", request.category || "—"],
    ["User", `${request.createdByDisplayName || "—"} <${request.createdByEmail || "—"}> (${request.createdByUid})`],
    ["Family", `${request.familyName || "—"} (${request.familyId})`],
    ["May contact reporter", request.allowContact ? "Yes" : "No"],
    ["Notify on status change", request.notifyOnStatusChange ? "Yes" : "No"],
    ["Current page", request.pageUrl || "—"],
  ];
  const d = request.diagnostics;
  if (d.browser || d.operatingSystem) {
    rows.push(["Browser / OS", `${d.browser || "—"} / ${d.operatingSystem || "—"}`]);
  }
  if (d.screenResolution) rows.push(["Screen", d.screenResolution]);
  if (d.language) rows.push(["Language", d.language]);
  if (d.appVersion) rows.push(["App version", d.appVersion]);
  if (request.userAgent) rows.push(["User agent", request.userAgent]);
  if (d.recentConsoleErrors) rows.push(["Recent console errors", d.recentConsoleErrors]);
  if (d.recentApiFailures) rows.push(["Recent API failures", d.recentApiFailures]);
  return rows;
}

export function buildSupportEmailPayload(request: SupportEmailRequest): EmailSendPayload {
  const rows = buildRows(request);
  const link = detailUrl(request);

  const textLines = [
    `New ${request.type} submitted: ${request.subject}`,
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "",
    "Description:",
    request.description,
    "",
    `Open in support console: ${link}`,
  ];

  const htmlRows = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#475569;vertical-align:top;white-space:nowrap;">${escapeHtml(
          label,
        )}</td><td style="padding:4px 0;color:#0f172a;">${escapeHtml(value)}</td></tr>`,
    )
    .join("");

  const html = `<!doctype html><html><body style="font-family:system-ui,-apple-system,sans-serif;color:#0f172a;">
  <h2 style="margin:0 0 12px;">New ${escapeHtml(request.type)} submitted</h2>
  <p style="margin:0 0 16px;font-size:16px;"><strong>${escapeHtml(request.subject)}</strong></p>
  <table style="border-collapse:collapse;font-size:14px;margin-bottom:16px;">${htmlRows}</table>
  <h3 style="margin:0 0 6px;">Description</h3>
  <p style="white-space:pre-wrap;font-size:14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;">${escapeHtml(
    request.description,
  )}</p>
  <p style="margin-top:16px;"><a href="${escapeHtml(link)}" style="color:#2563eb;">Open in support console &rarr;</a></p>
  </body></html>`;

  // When the reporter consented to contact, set Reply-To to their address so a
  // support reply reaches them directly; otherwise fall back to configured defaults.
  const replyTo =
    request.allowContact && request.createdByEmail
      ? [request.createdByEmail]
      : getEmailReplyToAddresses();

  return {
    to: [getSupportInboxAddress()],
    subject: buildSupportEmailSubject(request),
    html,
    text: textLines.join("\n"),
    replyTo: replyTo.length > 0 ? replyTo : undefined,
  };
}

// Best-effort: never throws. Email config may be absent in dev/test, and a failed
// notification must not fail the user's submission.
export async function sendSupportNotificationEmail(request: SupportEmailRequest): Promise<boolean> {
  try {
    const provider = getEmailProvider();
    await provider.send(buildSupportEmailPayload(request));
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.warn("[SUPPORT_EMAIL_SKIPPED]", reason.slice(0, 180));
    return false;
  }
}
