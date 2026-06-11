// Shared domain logic and constants for user-submitted support requests
// (bug reports + feature requests). The operator/debugging console at
// `/support` is unrelated and intentionally left untouched.

// Unified feedback entity types. `bug` and `feature` are the original two;
// `question` and `feedback` were added so this collection is the single source
// of truth for all user-submitted feedback (bugs, ideas, questions, praise).
export const SUPPORT_REQUEST_TYPES = ["bug", "feature", "question", "feedback"] as const;
export type SupportRequestType = (typeof SUPPORT_REQUEST_TYPES)[number];

// Types that carry an `importance` value (everything except bugs, which use
// `severity` instead). Bugs are graded by severity; non-bug requests are graded
// by how important the reporter feels they are.
export const IMPORTANCE_REQUEST_TYPES: readonly SupportRequestType[] = [
  "feature",
  "question",
  "feedback",
];

export function typeUsesImportance(type: SupportRequestType) {
  return IMPORTANCE_REQUEST_TYPES.includes(type);
}

export function typeUsesSeverity(type: SupportRequestType) {
  return type === "bug";
}

// Reporter-facing importance scale for non-bug requests. Optional on submit.
export const SUPPORT_REQUEST_IMPORTANCES = [
  "nice_to_have",
  "useful",
  "very_important",
  "blocking",
] as const;
export type SupportRequestImportance = (typeof SUPPORT_REQUEST_IMPORTANCES)[number];

export const FEATURE_CATEGORY_KEYS = [
  "feature_rewards_motivation",
  "feature_quests_adventures",
  "feature_family_engagement",
  "feature_personalization",
  "feature_sharing_growth",
  "feature_community",
  "feature_task_management",
  "feature_notifications",
  "feature_analytics",
  "other",
] as const;

export const BUG_CATEGORY_KEYS = [
  "bug_auth",
  "bug_chore_tracking",
  "bug_coin_rewards",
  "bug_notifications",
  "bug_quests",
  "bug_store",
  "bug_family",
  "bug_data_sync",
  "bug_interface",
  "bug_performance",
  "other",
] as const;

export type FeatureCategoryKey = (typeof FEATURE_CATEGORY_KEYS)[number];
export type BugCategoryKey = (typeof BUG_CATEGORY_KEYS)[number];

export const MAX_SUPPORT_CATEGORY_LENGTH = 100;

export const SUPPORT_REQUEST_SEVERITIES = ["low", "medium", "high"] as const;
export type SupportRequestSeverity = (typeof SUPPORT_REQUEST_SEVERITIES)[number];

// Operator-managed status lifecycle. Legacy first-pass statuses are normalized
// on read so older request documents remain valid without migration.
// Operator-managed status lifecycle. `needs_info`, `released`, and `closed` were
// added for the unified feedback workflow. Legacy `triaged`/`done` remain valid
// (older docs and existing tests rely on them) and are normalized on read so no
// data migration is required.
export const SUPPORT_REQUEST_STATUSES = [
  "new",
  "needs_info",
  "triaged",
  "planned",
  "in_progress",
  "released",
  "done",
  "closed",
  "declined",
  "duplicate",
  // Reporter cancelled the request. Terminal; kept for record-keeping. The
  // user-cancel flow also sets the `cancelledByUser` flag (used to hide the
  // request from the reporter's own list).
  "cancelled",
] as const;
export type SupportRequestStatus = (typeof SUPPORT_REQUEST_STATUSES)[number];

// Statuses that represent a terminal/resolved request (used for closedAt + metrics).
export const CLOSED_SUPPORT_REQUEST_STATUSES: readonly SupportRequestStatus[] = [
  "released",
  "done",
  "closed",
  "declined",
  "duplicate",
  "cancelled",
];

export function isClosedSupportRequestStatus(status: SupportRequestStatus) {
  return CLOSED_SUPPORT_REQUEST_STATUSES.includes(status);
}

export const PUBLIC_SUPPORT_REQUEST_STATUSES = [
  "under_review",
  "planned",
  "in_progress",
  "completed",
  "declined",
] as const;
export type PublicSupportRequestStatus = (typeof PUBLIC_SUPPORT_REQUEST_STATUSES)[number];

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
export const MAX_PUBLIC_SUPPORT_TITLE_LENGTH = 120;
export const MAX_PUBLIC_SUPPORT_DESCRIPTION_LENGTH = 1200;

// Caps for automatically-captured diagnostics. These are best-effort and never
// block submission, so values are simply clamped rather than rejected.
export const MAX_DIAGNOSTIC_SHORT_LENGTH = 120;
export const MAX_DIAGNOSTIC_LONG_LENGTH = 4000;

// Best-effort client/runtime metadata captured at submission time. Everything is
// optional; absence never blocks a submission (Phase 3).
export type SupportRequestDiagnostics = {
  browser: string;
  operatingSystem: string;
  screenResolution: string;
  language: string;
  appVersion: string;
  // Bug-only: recent client console errors and failed API calls, newest first.
  recentConsoleErrors: string;
  recentApiFailures: string;
};

export const EMPTY_DIAGNOSTICS: SupportRequestDiagnostics = {
  browser: "",
  operatingSystem: "",
  screenResolution: "",
  language: "",
  appVersion: "",
  recentConsoleErrors: "",
  recentApiFailures: "",
};

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
  // Reporter importance for non-bug requests; null for bugs (which use severity).
  importance: SupportRequestImportance | null;
  category: string;
  status: SupportRequestStatus;
  // Change-log day (YYYY-MM-DD) this request shipped in; only set when
  // `status === "applied"`, otherwise empty.
  appliedChangeLogDate: string;
  // Contact / notification preferences chosen by the reporter (Phase 2/7).
  allowContact: boolean;
  notifyOnStatusChange: boolean;
  // Operator assignment (Phase 6).
  assignedToUid: string;
  assignedToEmail: string;
  // Public roadmap / voting flags (Phase 8). `isPublic` is the legacy public
  // visibility flag; `allowVoting` gates community voting independently.
  allowVoting: boolean;
  votesCount: number;
  // Changelog linkage (Phase 9): the change-log entry id this shipped under.
  relatedChangelogEntryId: string;
  // Duplicate tracking + related-ticket links (Phase 6).
  duplicateOfId: string;
  relatedTicketIds: string[];
  pageUrl: string;
  userAgent: string;
  diagnostics: SupportRequestDiagnostics;
  createdAt: string;
  updatedAt: string;
  closedAt: string;
  deleted: boolean;
  isPublic: boolean;
  publicTitle: string;
  publicDescription: string;
  publicStatus: PublicSupportRequestStatus;
  publicPublishedAt: string;
  publicPublishedByUid: string;
  publicUpdatedAt: string;
};

export type SupportRequestInput = {
  type?: unknown;
  subject?: unknown;
  description?: unknown;
  severity?: unknown;
  importance?: unknown;
  category?: unknown;
  pageUrl?: unknown;
  userAgent?: unknown;
  allowContact?: unknown;
  notifyOnStatusChange?: unknown;
  diagnostics?: unknown;
};

export type NormalizedSupportRequest = {
  type: SupportRequestType;
  subject: string;
  description: string;
  severity: SupportRequestSeverity | null;
  importance: SupportRequestImportance | null;
  category: string;
  pageUrl: string;
  userAgent: string;
  allowContact: boolean;
  notifyOnStatusChange: boolean;
  diagnostics: SupportRequestDiagnostics;
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
  | "severity_not_allowed"
  | "importance_invalid"
  | "importance_not_allowed";

export type PublicSupportRequestInput = {
  isPublic?: unknown;
  publicTitle?: unknown;
  publicDescription?: unknown;
  publicStatus?: unknown;
};

export type NormalizedPublicSupportRequest = {
  isPublic: boolean;
  publicTitle: string;
  publicDescription: string;
  publicStatus: PublicSupportRequestStatus;
};

export type PublicSupportRequestValidationError =
  | "public_title_required"
  | "public_title_too_long"
  | "public_description_required"
  | "public_description_too_long"
  | "public_status_invalid";

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

export function isSupportRequestImportance(value: unknown): value is SupportRequestImportance {
  return (
    typeof value === "string" &&
    SUPPORT_REQUEST_IMPORTANCES.includes(value as SupportRequestImportance)
  );
}

export function isPublicSupportRequestStatus(value: unknown): value is PublicSupportRequestStatus {
  return (
    typeof value === "string" &&
    PUBLIC_SUPPORT_REQUEST_STATUSES.includes(value as PublicSupportRequestStatus)
  );
}

// Normalizes best-effort client diagnostics into a clamped, typed shape. Always
// succeeds — missing or malformed values simply become empty strings.
export function normalizeDiagnostics(input: unknown): SupportRequestDiagnostics {
  const source = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const short = (key: string) =>
    typeof source[key] === "string" ? clampString((source[key] as string).trim(), MAX_DIAGNOSTIC_SHORT_LENGTH) : "";
  const long = (key: string) =>
    typeof source[key] === "string" ? clampString((source[key] as string).trim(), MAX_DIAGNOSTIC_LONG_LENGTH) : "";
  return {
    browser: short("browser"),
    operatingSystem: short("operatingSystem"),
    screenResolution: short("screenResolution"),
    language: short("language"),
    appVersion: short("appVersion"),
    recentConsoleErrors: long("recentConsoleErrors"),
    recentApiFailures: long("recentApiFailures"),
  };
}

export function mapInternalStatusToPublicStatus(
  status: SupportRequestStatus,
): PublicSupportRequestStatus {
  if (status === "planned") return "planned";
  if (status === "in_progress") return "in_progress";
  if (status === "done" || status === "released" || status === "closed") return "completed";
  if (status === "declined" || status === "duplicate" || status === "cancelled") return "declined";
  // new, needs_info, triaged
  return "under_review";
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

  // Bugs are graded by severity (required); non-bug types use importance instead.
  let severity: SupportRequestSeverity | null = null;
  const hasSeverity =
    input.severity !== undefined && input.severity !== null && input.severity !== "";
  if (typeUsesSeverity(type)) {
    if (!hasSeverity) {
      return { ok: false, error: "severity_required" };
    }
    if (!isSupportRequestSeverity(input.severity)) {
      return { ok: false, error: "severity_invalid" };
    }
    severity = input.severity;
  } else if (hasSeverity) {
    // Non-bug requests must not carry a severity.
    return { ok: false, error: "severity_not_allowed" };
  }

  // Importance is optional, but only valid on non-bug types.
  let importance: SupportRequestImportance | null = null;
  const hasImportance =
    input.importance !== undefined && input.importance !== null && input.importance !== "";
  if (hasImportance) {
    if (!typeUsesImportance(type)) {
      return { ok: false, error: "importance_not_allowed" };
    }
    if (!isSupportRequestImportance(input.importance)) {
      return { ok: false, error: "importance_invalid" };
    }
    importance = input.importance;
  }

  const category =
    typeof input.category === "string"
      ? clampString(input.category.trim(), MAX_SUPPORT_CATEGORY_LENGTH)
      : "";

  const pageUrl =
    typeof input.pageUrl === "string"
      ? clampString(input.pageUrl.trim(), MAX_SUPPORT_PAGE_URL_LENGTH)
      : "";
  const userAgent =
    typeof input.userAgent === "string"
      ? clampString(input.userAgent.trim(), MAX_SUPPORT_USER_AGENT_LENGTH)
      : "";

  const allowContact = input.allowContact === true;
  const notifyOnStatusChange = input.notifyOnStatusChange === true;
  // Diagnostics are only meaningful for bug reports, but we accept and store
  // whatever the client provides for any type without blocking submission.
  const diagnostics = normalizeDiagnostics(input.diagnostics);

  return {
    ok: true,
    value: {
      type,
      subject,
      description,
      severity,
      importance,
      category,
      pageUrl,
      userAgent,
      allowContact,
      notifyOnStatusChange,
      diagnostics,
    },
  };
}

export function validatePublicSupportRequest(
  input: PublicSupportRequestInput,
): { ok: true; value: NormalizedPublicSupportRequest } | { ok: false; error: PublicSupportRequestValidationError } {
  const isPublic = input.isPublic === true;
  const publicTitle = typeof input.publicTitle === "string" ? input.publicTitle.trim() : "";
  const publicDescription =
    typeof input.publicDescription === "string" ? input.publicDescription.trim() : "";
  const publicStatus =
    input.publicStatus === undefined || input.publicStatus === null || input.publicStatus === ""
      ? "under_review"
      : input.publicStatus;

  if (!isPublic) {
    return {
      ok: true,
      value: {
        isPublic: false,
        publicTitle,
        publicDescription,
        publicStatus: isPublicSupportRequestStatus(publicStatus) ? publicStatus : "under_review",
      },
    };
  }

  if (!publicTitle) {
    return { ok: false, error: "public_title_required" };
  }
  if (publicTitle.length > MAX_PUBLIC_SUPPORT_TITLE_LENGTH) {
    return { ok: false, error: "public_title_too_long" };
  }
  if (!publicDescription) {
    return { ok: false, error: "public_description_required" };
  }
  if (publicDescription.length > MAX_PUBLIC_SUPPORT_DESCRIPTION_LENGTH) {
    return { ok: false, error: "public_description_too_long" };
  }
  if (!isPublicSupportRequestStatus(publicStatus)) {
    return { ok: false, error: "public_status_invalid" };
  }

  return {
    ok: true,
    value: { isPublic, publicTitle, publicDescription, publicStatus },
  };
}
