// Shared domain logic and constants for user-submitted support requests
// (bug reports + feature requests). The operator/debugging console at
// `/support` is unrelated and intentionally left untouched.

export const SUPPORT_REQUEST_TYPES = ["bug", "feature"] as const;
export type SupportRequestType = (typeof SUPPORT_REQUEST_TYPES)[number];

export const SUPPORT_REQUEST_SEVERITIES = ["low", "medium", "high"] as const;
export type SupportRequestSeverity = (typeof SUPPORT_REQUEST_SEVERITIES)[number];

// Operator-managed status lifecycle. Legacy first-pass statuses are normalized
// on read so older request documents remain valid without migration.
export const SUPPORT_REQUEST_STATUSES = [
  "new",
  "triaged",
  "planned",
  "in_progress",
  "done",
  "declined",
  "duplicate",
] as const;
export type SupportRequestStatus = (typeof SUPPORT_REQUEST_STATUSES)[number];

// Status assigned to brand-new requests created through this feature.
export const DEFAULT_SUPPORT_REQUEST_STATUS: SupportRequestStatus = "new";

// Maps legacy/unknown stored statuses onto the current set.
export function normalizeSupportRequestStatus(raw: string): SupportRequestStatus {
  if (raw === "new" || raw === "submitted" || raw === "") {
    return "new";
  }
  if (raw === "acknowledged") {
    return "triaged";
  }
  if (raw === "applied") {
    return "done";
  }
  if (raw === "rejected") {
    return "declined";
  }
  return SUPPORT_REQUEST_STATUSES.includes(raw as SupportRequestStatus)
    ? (raw as SupportRequestStatus)
    : "new";
}

export const MAX_SUPPORT_SUBJECT_LENGTH = 150;
export const MAX_SUPPORT_DESCRIPTION_LENGTH = 4000;
export const MAX_SUPPORT_PAGE_URL_LENGTH = 2000;
export const MAX_SUPPORT_USER_AGENT_LENGTH = 400;

export type SupportRequest = {
  id: string;
  familyId: string;
  createdByUid: string;
  createdByMemberId: string;
  createdByDisplayName: string;
  createdByEmail: string;
  type: SupportRequestType;
  subject: string;
  description: string;
  severity: SupportRequestSeverity | null;
  status: SupportRequestStatus;
  // Change-log day (YYYY-MM-DD) this request shipped in; only set when
  // `status === "applied"`, otherwise empty.
  appliedChangeLogDate: string;
  pageUrl: string;
  userAgent: string;
  createdAt: string;
  updatedAt: string;
  deleted: boolean;
};

export type SupportRequestInput = {
  type?: unknown;
  subject?: unknown;
  description?: unknown;
  severity?: unknown;
  pageUrl?: unknown;
  userAgent?: unknown;
};

export type NormalizedSupportRequest = {
  type: SupportRequestType;
  subject: string;
  description: string;
  severity: SupportRequestSeverity | null;
  pageUrl: string;
  userAgent: string;
};

export type SupportRequestValidationError =
  | "type_required"
  | "type_invalid"
  | "subject_required"
  | "subject_too_long"
  | "description_required"
  | "description_too_long"
  | "severity_required"
  | "severity_invalid"
  | "severity_not_allowed";

export function isSupportRequestType(value: unknown): value is SupportRequestType {
  return (
    typeof value === "string" &&
    SUPPORT_REQUEST_TYPES.includes(value as SupportRequestType)
  );
}

export function isSupportRequestSeverity(value: unknown): value is SupportRequestSeverity {
  return (
    typeof value === "string" &&
    SUPPORT_REQUEST_SEVERITIES.includes(value as SupportRequestSeverity)
  );
}

function clampString(value: string, maxLength: number) {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

// Shared validation used by both client and server. Returns either a normalized
// payload ready to persist or a stable error code that maps to a locale key.
export function validateSupportRequest(
  input: SupportRequestInput,
): { ok: true; value: NormalizedSupportRequest } | { ok: false; error: SupportRequestValidationError } {
  if (input.type === undefined || input.type === null || input.type === "") {
    return { ok: false, error: "type_required" };
  }
  if (!isSupportRequestType(input.type)) {
    return { ok: false, error: "type_invalid" };
  }
  const type = input.type;

  const subject = typeof input.subject === "string" ? input.subject.trim() : "";
  if (!subject) {
    return { ok: false, error: "subject_required" };
  }
  if (subject.length > MAX_SUPPORT_SUBJECT_LENGTH) {
    return { ok: false, error: "subject_too_long" };
  }

  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (!description) {
    return { ok: false, error: "description_required" };
  }
  if (description.length > MAX_SUPPORT_DESCRIPTION_LENGTH) {
    return { ok: false, error: "description_too_long" };
  }

  let severity: SupportRequestSeverity | null = null;
  const hasSeverity =
    input.severity !== undefined && input.severity !== null && input.severity !== "";
  if (type === "bug") {
    if (!hasSeverity) {
      return { ok: false, error: "severity_required" };
    }
    if (!isSupportRequestSeverity(input.severity)) {
      return { ok: false, error: "severity_invalid" };
    }
    severity = input.severity;
  } else if (hasSeverity) {
    // Feature requests must not carry a severity.
    return { ok: false, error: "severity_not_allowed" };
  }

  const pageUrl =
    typeof input.pageUrl === "string"
      ? clampString(input.pageUrl.trim(), MAX_SUPPORT_PAGE_URL_LENGTH)
      : "";
  const userAgent =
    typeof input.userAgent === "string"
      ? clampString(input.userAgent.trim(), MAX_SUPPORT_USER_AGENT_LENGTH)
      : "";

  return {
    ok: true,
    value: { type, subject, description, severity, pageUrl, userAgent },
  };
}
