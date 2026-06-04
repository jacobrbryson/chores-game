import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const {
  mockGetSession,
  mockIsSupportAdmin,
  mockBuildPreview,
  mockTestSend,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockIsSupportAdmin: vi.fn(),
  mockBuildPreview: vi.fn(),
  mockTestSend: vi.fn(),
}));

vi.mock("@/lib/auth/request-session", () => ({
  getSessionFromRequest: mockGetSession,
}));
vi.mock("@/lib/support/access", () => ({
  isSupportAdmin: mockIsSupportAdmin,
}));
vi.mock("@/lib/newsletters/service", () => ({
  buildWeeklyFamilyHighlightsPreview: mockBuildPreview,
  sendWeeklyFamilyHighlightsTest: mockTestSend,
}));

import { GET as PREVIEW_GET } from "@/app/api/support/newsletters/weekly/preview/route";
import { POST as TEST_SEND_POST } from "@/app/api/support/newsletters/weekly/test-send/route";

describe("support newsletter routes", () => {
  it("allows support admins to preview", async () => {
    mockGetSession.mockReturnValue({ uid: "support-1", email: "support@example.com", locale: "en-US" });
    mockIsSupportAdmin.mockReturnValue(true);
    mockBuildPreview.mockResolvedValue({ rendered: { subject: "Preview" } });

    const response = await PREVIEW_GET(new NextRequest("http://localhost/api/support/newsletters/weekly/preview?familyId=family-1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.rendered.subject).toBe("Preview");
  });

  it("blocks non-support users from newsletter diagnostics", async () => {
    mockGetSession.mockReturnValue({ uid: "user-1", email: "user@example.com", locale: "en-US" });
    mockIsSupportAdmin.mockReturnValue(false);

    const response = await PREVIEW_GET(new NextRequest("http://localhost/api/support/newsletters/weekly/preview?familyId=family-1"));

    expect(response.status).toBe(403);
  });

  it("test-send only targets the requesting support admin", async () => {
    mockGetSession.mockReturnValue({ uid: "support-1", email: "support@example.com", locale: "en-US" });
    mockIsSupportAdmin.mockReturnValue(true);
    mockTestSend.mockResolvedValue({
      provider: "ses",
      providerMessageId: "msg-1",
      preview: { rendered: { subject: "Preview" } },
    });

    const response = await TEST_SEND_POST(new NextRequest("http://localhost/api/support/newsletters/weekly/test-send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ familyId: "family-1" }),
    }));

    expect(response.status).toBe(200);
    expect(mockTestSend).toHaveBeenCalledWith({
      familyId: "family-1",
      recipientEmail: "support@example.com",
      recipientLocale: "en-US",
    });
  });
});
