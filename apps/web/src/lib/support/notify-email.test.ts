import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EMPTY_DIAGNOSTICS } from "@/lib/support/requests";
import {
  buildSupportEmailPayload,
  buildSupportEmailSubject,
  getSupportInboxAddress,
  type SupportEmailRequest,
} from "@/lib/support/notify-email";

function makeRequest(overrides: Partial<SupportEmailRequest> = {}): SupportEmailRequest {
  return {
    id: "req-1",
    familyId: "fam-1",
    familyName: "Alpha",
    type: "bug",
    status: "new",
    subject: "Chore page freezes",
    description: "It freezes when I approve a chore.",
    severity: "high",
    importance: null,
    category: "bug_chore_tracking",
    createdByUid: "uid-1",
    createdByDisplayName: "Pat",
    createdByEmail: "pat@example.com",
    allowContact: true,
    notifyOnStatusChange: true,
    pageUrl: "/chores",
    userAgent: "Mozilla/5.0",
    diagnostics: { ...EMPTY_DIAGNOSTICS, browser: "Chrome", operatingSystem: "Windows" },
    ...overrides,
  };
}

describe("support notification email", () => {
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  const originalReplyTo = process.env.EMAIL_REPLY_TO_ADDRESS;
  const originalInbox = process.env.SUPPORT_INBOX_ADDRESS;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
    delete process.env.EMAIL_REPLY_TO_ADDRESS;
    delete process.env.SUPPORT_INBOX_ADDRESS;
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
    process.env.EMAIL_REPLY_TO_ADDRESS = originalReplyTo;
    process.env.SUPPORT_INBOX_ADDRESS = originalInbox;
  });

  it("prefixes the subject with the type tag", () => {
    expect(buildSupportEmailSubject(makeRequest({ type: "bug" }))).toBe("[BUG] Chore page freezes");
    expect(buildSupportEmailSubject(makeRequest({ type: "feature" }))).toBe(
      "[FEATURE] Chore page freezes",
    );
    expect(buildSupportEmailSubject(makeRequest({ type: "question" }))).toBe(
      "[QUESTION] Chore page freezes",
    );
    expect(buildSupportEmailSubject(makeRequest({ type: "feedback" }))).toBe(
      "[FEEDBACK] Chore page freezes",
    );
  });

  it("defaults the recipient to the support inbox", () => {
    expect(getSupportInboxAddress()).toBe("developers@orcwood.com");
    const payload = buildSupportEmailPayload(makeRequest());
    expect(payload.to).toEqual(["developers@orcwood.com"]);
  });

  it("sets reply-to to the reporter when they consent to contact", () => {
    const payload = buildSupportEmailPayload(makeRequest({ allowContact: true }));
    expect(payload.replyTo).toEqual(["pat@example.com"]);
  });

  it("omits the reporter reply-to when contact is not allowed", () => {
    const payload = buildSupportEmailPayload(makeRequest({ allowContact: false }));
    expect(payload.replyTo).toBeUndefined();
  });

  it("includes the deep link, description, and key metadata in the body", () => {
    const payload = buildSupportEmailPayload(makeRequest());
    expect(payload.text).toContain("https://app.example.com/support/requests?focus=req-1");
    expect(payload.text).toContain("It freezes when I approve a chore.");
    expect(payload.text).toContain("Severity: high");
    expect(payload.html).toContain("Chrome");
  });

  it("labels the grade as importance for non-bug requests", () => {
    const payload = buildSupportEmailPayload(
      makeRequest({ type: "feature", severity: null, importance: "very_important" }),
    );
    expect(payload.text).toContain("Importance: very_important");
  });
});
