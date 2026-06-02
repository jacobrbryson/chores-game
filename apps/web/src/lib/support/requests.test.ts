import { describe, expect, it } from "vitest";
import {
  MAX_SUPPORT_SUBJECT_LENGTH,
  SUPPORT_REQUEST_STATUSES,
  validateSupportRequest,
} from "@/lib/support/requests";

describe("validateSupportRequest", () => {
  it("requires a type", () => {
    const result = validateSupportRequest({ subject: "Hi", description: "There" });
    expect(result).toEqual({ ok: false, error: "type_required" });
  });

  it("rejects an unknown type", () => {
    const result = validateSupportRequest({ type: "question", subject: "Hi", description: "There" });
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
        pageUrl: "/chores",
        userAgent: "",
      },
    });
  });

  it("rejects severity on feature requests", () => {
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
});

describe("support request status lifecycle", () => {
  it("defines the expected ordered statuses", () => {
    expect(SUPPORT_REQUEST_STATUSES).toEqual([
      "new",
      "triaged",
      "planned",
      "in_progress",
      "done",
      "declined",
      "duplicate",
    ]);
  });
});
