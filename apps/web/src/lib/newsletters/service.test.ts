import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildWeeklyFamilyHighlightsPreview,
  sendWeeklyFamilyHighlightsForAllFamilies,
  sendWeeklyFamilyHighlightsForFamily,
} from "@/lib/newsletters/service";

const {
  mockGetEmailProvider,
  mockRenderEmailTemplate,
  mockAdminCreateOrReplaceDocument,
  mockAdminGetDocument,
  mockAdminListDocuments,
  mockAdminRunQuery,
  mockLoadContext,
  mockComputeMetrics,
} = vi.hoisted(() => ({
  mockGetEmailProvider: vi.fn(),
  mockRenderEmailTemplate: vi.fn(),
  mockAdminCreateOrReplaceDocument: vi.fn(),
  mockAdminGetDocument: vi.fn(),
  mockAdminListDocuments: vi.fn(),
  mockAdminRunQuery: vi.fn(),
  mockLoadContext: vi.fn(),
  mockComputeMetrics: vi.fn(),
}));

vi.mock("@/lib/email/provider", () => ({
  getEmailProvider: mockGetEmailProvider,
  getEmailReplyToAddresses: () => [],
}));
vi.mock("@/lib/email/templates", () => ({
  renderEmailTemplate: mockRenderEmailTemplate,
}));
vi.mock("@/lib/firestore/admin", () => ({
  adminCreateOrReplaceDocument: mockAdminCreateOrReplaceDocument,
  adminGetDocument: mockAdminGetDocument,
  adminListDocuments: mockAdminListDocuments,
  adminRunQuery: mockAdminRunQuery,
}));
vi.mock("@/lib/newsletters/metrics", () => ({
  loadNewsletterFamilyContext: mockLoadContext,
  computeWeeklyFamilyHighlightMetrics: mockComputeMetrics,
  getRecipientSkipReason: (recipient: { email: string; optedIn: boolean }) => {
    if (!recipient.email) return "invalid_email";
    if (!recipient.optedIn) return "opt_out";
    return "";
  },
}));

describe("newsletter service", () => {
  beforeEach(() => {
    mockGetEmailProvider.mockReset();
    mockRenderEmailTemplate.mockReset();
    mockAdminCreateOrReplaceDocument.mockReset();
    mockAdminGetDocument.mockReset();
    mockAdminListDocuments.mockReset();
    mockAdminRunQuery.mockReset();
    mockLoadContext.mockReset();
    mockComputeMetrics.mockReset();
    process.env.NEXT_PUBLIC_APP_URL = "https://example.com";
  });

  it("builds a preview with rendered email output", async () => {
    mockLoadContext.mockResolvedValue({
      familyId: "family-1",
      familyName: "Rivera",
      familyLocale: "en-US",
      recipients: [],
      activeMemberUids: ["player-1"],
    });
    mockComputeMetrics.mockResolvedValue({
      choresCompleted: 1,
      coinsEarned: 2,
      rewardsRedeemed: 3,
      familyAwardsClaimed: 4,
      questsCompleted: 5,
      achievementsUnlocked: 6,
      pendingApprovals: 7,
      mostActiveHelperName: "Ava",
      mostActiveHelperCount: 1,
      recentHighlights: [],
      hasActivity: true,
    });
    mockRenderEmailTemplate.mockReturnValue({
      subject: "Subject",
      html: "<p>Preview</p>",
      text: "Preview",
    });

    const preview = await buildWeeklyFamilyHighlightsPreview({ familyId: "family-1" });

    expect(preview.rendered.subject).toBe("Subject");
    expect(mockRenderEmailTemplate).toHaveBeenCalled();
  });

  it("prevents duplicate sends for already-sent recipients", async () => {
    mockAdminListDocuments.mockResolvedValue([{ name: "families/family-1", fields: {} }]);
    mockLoadContext.mockResolvedValue({
      familyId: "family-1",
      familyName: "Rivera",
      familyLocale: "en-US",
      recipients: [{ uid: "admin-1", email: "parent@example.com", locale: "en-US", name: "Parent", optedIn: true }],
      activeMemberUids: ["player-1"],
    });
    mockComputeMetrics.mockResolvedValue({
      choresCompleted: 1,
      coinsEarned: 1,
      rewardsRedeemed: 0,
      familyAwardsClaimed: 0,
      questsCompleted: 0,
      achievementsUnlocked: 0,
      pendingApprovals: 0,
      mostActiveHelperName: "Ava",
      mostActiveHelperCount: 1,
      recentHighlights: [],
      hasActivity: true,
    });
    mockRenderEmailTemplate.mockReturnValue({ subject: "Weekly", html: "<p>Hi</p>", text: "Hi" });
    mockAdminGetDocument.mockResolvedValue({
      name: "families/family-1/newsletterSends/weekly_2026-05-26_admin-1",
      fields: {
        familyId: { stringValue: "family-1" },
        weekStart: { stringValue: "2026-05-26T00:00:00.000Z" },
        weekEnd: { stringValue: "2026-06-01T23:59:59.999Z" },
        recipientUid: { stringValue: "admin-1" },
        recipientEmail: { stringValue: "parent@example.com" },
        recipientLocale: { stringValue: "en-US" },
        status: { stringValue: "sent" },
        provider: { stringValue: "ses" },
        providerMessageId: { stringValue: "msg-1" },
      },
    });
    const send = vi.fn();
    mockGetEmailProvider.mockReturnValue({ name: "ses", send });

    const result = await sendWeeklyFamilyHighlightsForAllFamilies({
      window: {
        weekStart: "2026-05-26T00:00:00.000Z",
        weekEnd: "2026-06-01T23:59:59.999Z",
        weekStartDateOnly: "2026-05-26",
        weekEndDateOnly: "2026-06-01",
      },
    });

    expect(result.skipped).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });

  it("records failures and skips safely", async () => {
    mockAdminListDocuments.mockResolvedValue([{ name: "families/family-1", fields: {} }]);
    mockLoadContext.mockResolvedValue({
      familyId: "family-1",
      familyName: "Rivera",
      familyLocale: "en-US",
      recipients: [
        { uid: "admin-1", email: "parent@example.com", locale: "en-US", name: "Parent", optedIn: true },
        { uid: "admin-2", email: "", locale: "en-US", name: "Second Parent", optedIn: true },
      ],
      activeMemberUids: ["player-1"],
    });
    mockComputeMetrics.mockResolvedValue({
      choresCompleted: 1,
      coinsEarned: 1,
      rewardsRedeemed: 0,
      familyAwardsClaimed: 0,
      questsCompleted: 0,
      achievementsUnlocked: 0,
      pendingApprovals: 0,
      mostActiveHelperName: "Ava",
      mostActiveHelperCount: 1,
      recentHighlights: [],
      hasActivity: true,
    });
    mockRenderEmailTemplate.mockReturnValue({ subject: "Weekly", html: "<p>Hi</p>", text: "Hi" });
    mockAdminGetDocument.mockRejectedValue(new Error("FIRESTORE_ADMIN_HTTP_404_document not found"));
    const send = vi.fn().mockRejectedValue(new Error("SES sandbox"));
    mockGetEmailProvider.mockReturnValue({ name: "ses", send });

    const result = await sendWeeklyFamilyHighlightsForAllFamilies({
      window: {
        weekStart: "2026-05-26T00:00:00.000Z",
        weekEnd: "2026-06-01T23:59:59.999Z",
        weekStartDateOnly: "2026-05-26",
        weekEndDateOnly: "2026-06-01",
      },
    });

    expect(result.failed).toBe(1);
    expect(result.skipped).toBe(1);
    expect(mockAdminCreateOrReplaceDocument).toHaveBeenCalled();
  });

  it("skips no-activity families on the weekly run but sends them when forced for one family", async () => {
    mockAdminListDocuments.mockResolvedValue([{ name: "families/family-1", fields: {} }]);
    mockLoadContext.mockResolvedValue({
      familyId: "family-1",
      familyName: "Rivera",
      familyLocale: "en-US",
      recipients: [{ uid: "admin-1", email: "parent@example.com", locale: "en-US", name: "Parent", optedIn: true }],
      activeMemberUids: ["player-1"],
    });
    mockComputeMetrics.mockResolvedValue({
      choresCompleted: 0,
      coinsEarned: 0,
      rewardsRedeemed: 0,
      familyAwardsClaimed: 0,
      questsCompleted: 0,
      achievementsUnlocked: 0,
      pendingApprovals: 0,
      mostActiveHelperName: "",
      mostActiveHelperCount: 0,
      recentHighlights: [],
      hasActivity: false,
    });
    mockRenderEmailTemplate.mockReturnValue({ subject: "Weekly", html: "<p>Hi</p>", text: "Hi" });
    mockAdminGetDocument.mockRejectedValue(new Error("FIRESTORE_ADMIN_HTTP_404_document not found"));
    const send = vi.fn().mockResolvedValue({ provider: "ses", messageId: "msg-forced" });
    mockGetEmailProvider.mockReturnValue({ name: "ses", send });

    const window = {
      weekStart: "2026-05-26T00:00:00.000Z",
      weekEnd: "2026-06-01T23:59:59.999Z",
      weekStartDateOnly: "2026-05-26",
      weekEndDateOnly: "2026-06-01",
    };

    // Weekly run: quiet family is skipped with no_activity.
    const weeklyResult = await sendWeeklyFamilyHighlightsForAllFamilies({ window });
    expect(weeklyResult.skipped).toBe(1);
    expect(weeklyResult.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();

    // Manual support trigger: same quiet family is emailed once.
    const forcedResult = await sendWeeklyFamilyHighlightsForFamily({
      familyId: "family-1",
      window,
      allowNoActivity: true,
    });
    expect(forcedResult.sent).toBe(1);
    expect(forcedResult.skipped).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
