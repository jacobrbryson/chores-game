import { describe, expect, it } from "vitest";
import {
  isClosedSupportRequestStatus,
  mapInternalStatusToPublicStatus,
  MAX_SUPPORT_SUBJECT_LENGTH,
  normalizeDiagnostics,
  normalizeSupportRequestStatus,
  SUPPORT_REQUEST_STATUSES,
  validateSupportRequest,
} from "@/lib/support/requests";

describe("validateSupportRequest", () => {
  it("requires a type", () => {
    const result = validateSupportRequest({ subject: "Hi", description: "There" });
    expect(result).toEqual({ ok: false, error: "type_required" });
  });

  it("rejects an unknown type", () => {
    const result = validateSupportRequest({ type: "complaint", subject: "Hi", description: "There" });
    expect(result).toEqual({ ok: false, error: "type_invalid" });
  });

  it("requires a subject", () => {
    const result = validateSupportRequest({ type: "feature", subject: "   ", description: "There" });
    expect(result).toEqual({ ok: false, error: "subject_required" });
  });

  it("rejects an overlong subject", () => {
    const result = validateSupportRequest({
      type: "feature",
      subject: "a".repeat(MAX_SUPPORT_SUBJECT_LENGTH + 1),
      description: "There",
    });
    expect(result).toEqual({ ok: false, error: "subject_too_long" });
  });

  it("requires a description", () => {
    const result = validateSupportRequest({ type: "feature", subject: "Hi", description: "" });
    expect(result).toEqual({ ok: false, error: "description_required" });
  });

  it("requires severity for bug reports", () => {
    const result = validateSupportRequest({ type: "bug", subject: "Hi", description: "There" });
    expect(result).toEqual({ ok: false, error: "severity_required" });
  });

  it("rejects an invalid severity for bug reports", () => {
    const result = validateSupportRequest({
      type: "bug",
      subject: "Hi",
      description: "There",
      severity: "critical",
    });
    expect(result).toEqual({ ok: false, error: "severity_invalid" });
  });

  it("accepts a valid bug report and normalizes fields", () => {
    const result = validateSupportRequest({
      type: "bug",
      subject: "  Crash on save  ",
      description: "  It crashes  ",
      severity: "high",
      pageUrl: "/chores",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        type: "bug",
        subject: "Crash on save",
        description: "It crashes",
        severity: "high",
        importance: null,
        category: "",
        pageUrl: "/chores",
        userAgent: "",
        allowContact: false,
        notifyOnStatusChange: false,
        diagnostics: {
          browser: "",
          operatingSystem: "",
          screenResolution: "",
          language: "",
          appVersion: "",
          recentConsoleErrors: "",
          recentApiFailures: "",
        },
      },
    });
  });

  it("rejects severity on non-bug requests", () => {
    const result = validateSupportRequest({
      type: "feature",
      subject: "Dark mode",
      description: "Please add it",
      severity: "low",
    });
    expect(result).toEqual({ ok: false, error: "severity_not_allowed" });
  });

  it("accepts a feature request with a null severity", () => {
    const result = validateSupportRequest({
      type: "feature",
      subject: "Dark mode",
      description: "Please add it",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.severity).toBeNull();
    }
  });

  it("accepts question and feedback types", () => {
    for (const type of ["question", "feedback"] as const) {
      const result = validateSupportRequest({ type, subject: "Hi", description: "There" });
      expect(result.ok).toBe(true);
    }
  });

  it("accepts importance on non-bug requests", () => {
    const result = validateSupportRequest({
      type: "feature",
      subject: "Dark mode",
      description: "Please add it",
      importance: "very_important",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.importance).toBe("very_important");
    }
  });

  it("rejects an invalid importance value", () => {
    const result = validateSupportRequest({
      type: "feature",
      subject: "Dark mode",
      description: "Please add it",
      importance: "critical",
    });
    expect(result).toEqual({ ok: false, error: "importance_invalid" });
  });

  it("rejects importance on bug reports", () => {
    const result = validateSupportRequest({
      type: "bug",
      subject: "Crash",
      description: "It crashes",
      severity: "high",
      importance: "useful",
    });
    expect(result).toEqual({ ok: false, error: "importance_not_allowed" });
  });

  it("captures contact and notification preferences", () => {
    const result = validateSupportRequest({
      type: "feedback",
      subject: "Love it",
      description: "Great app",
      allowContact: true,
      notifyOnStatusChange: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.allowContact).toBe(true);
      expect(result.value.notifyOnStatusChange).toBe(true);
    }
  });
});

describe("support request status lifecycle", () => {
  it("defines the expected ordered statuses", () => {
    expect(SUPPORT_REQUEST_STATUSES).toEqual([
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
      "cancelled",
    ]);
  });

  it("treats released/done/closed/declined/duplicate/cancelled as terminal", () => {
    for (const status of [
      "released",
      "done",
      "closed",
      "declined",
      "duplicate",
      "cancelled",
    ] as const) {
      expect(isClosedSupportRequestStatus(status)).toBe(true);
    }
    for (const status of ["new", "needs_info", "triaged", "planned", "in_progress"] as const) {
      expect(isClosedSupportRequestStatus(status)).toBe(false);
    }
  });

  it("normalizes legacy stored statuses", () => {
    expect(normalizeSupportRequestStatus("submitted")).toBe("new");
    expect(normalizeSupportRequestStatus("acknowledged")).toBe("triaged");
    expect(normalizeSupportRequestStatus("applied")).toBe("done");
    expect(normalizeSupportRequestStatus("rejected")).toBe("declined");
    expect(normalizeSupportRequestStatus("needs_info")).toBe("needs_info");
  });

  it("maps internal statuses to public statuses", () => {
    expect(mapInternalStatusToPublicStatus("released")).toBe("completed");
    expect(mapInternalStatusToPublicStatus("closed")).toBe("completed");
    expect(mapInternalStatusToPublicStatus("needs_info")).toBe("under_review");
    expect(mapInternalStatusToPublicStatus("planned")).toBe("planned");
    expect(mapInternalStatusToPublicStatus("declined")).toBe("declined");
  });
});

describe("normalizeDiagnostics", () => {
  it("returns empty strings for missing input", () => {
    expect(normalizeDiagnostics(undefined)).toEqual({
      browser: "",
      operatingSystem: "",
      screenResolution: "",
      language: "",
      appVersion: "",
      recentConsoleErrors: "",
      recentApiFailures: "",
    });
  });

  it("trims and keeps provided fields", () => {
    const result = normalizeDiagnostics({ browser: "  Chrome  ", language: "en-US", junk: 5 });
    expect(result.browser).toBe("Chrome");
    expect(result.language).toBe("en-US");
    expect(result.appVersion).toBe("");
  });
});
