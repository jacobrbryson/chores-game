import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSend, mockCreateDocument, mockInviteEmailEnabled } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockCreateDocument: vi.fn(),
  mockInviteEmailEnabled: vi.fn(),
}));

vi.mock("@/lib/email/provider", () => ({
  getEmailProvider: () => ({ send: mockSend }),
  getEmailReplyToAddresses: () => [],
}));
vi.mock("@/lib/email/preferences", () => ({
  isFamilyFriendInviteEmailEnabled: mockInviteEmailEnabled,
}));
vi.mock("@/lib/firestore/admin", () => ({
  adminCreateOrReplaceDocument: mockCreateDocument,
}));

import { notifyFamilyFriendInvite } from "@/lib/family-friends/notify";

const BASE_INPUT = {
  inviteId: "invite-1",
  token: "token-1",
  fromFamilyName: "The Smiths",
  fromAdminName: "Sam",
  toEmail: "friend@example.com",
  toFamilyId: "family-2",
  targetAdminUid: "uid-2",
  locale: "en-US",
};

describe("notifyFamilyFriendInvite", () => {
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
    mockSend.mockResolvedValue(undefined);
    mockCreateDocument.mockResolvedValue(undefined);
    mockInviteEmailEnabled.mockResolvedValue(true);
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
  });

  it("links the call to action at the canonical app origin", async () => {
    const result = await notifyFamilyFriendInvite(BASE_INPUT);

    expect(result).toEqual({ inApp: true, email: true, emailOptedOut: false });
    const payload = mockSend.mock.calls[0][0];
    const expectedUrl =
      "https://app.example.com/api/family-friends/invitations/email-confirm?invite=invite-1&token=token-1";
    expect(payload.text).toContain(expectedUrl);
    expect(payload.html).toContain(`href="${expectedUrl.replace("&", "&amp;")}"`);
  });

  it("skips the email when the recipient turned Family Friend invite emails off", async () => {
    mockInviteEmailEnabled.mockResolvedValue(false);

    const result = await notifyFamilyFriendInvite(BASE_INPUT);

    expect(mockSend).not.toHaveBeenCalled();
    expect(result).toEqual({ inApp: true, email: false, emailOptedOut: true });
    // The in-app notification is still written so the request can be approved.
    expect(mockCreateDocument).toHaveBeenCalledWith(
      expect.stringContaining("families/family-2/notifications/"),
      expect.anything(),
    );
  });

  it("emails recipients without an account without checking a preference", async () => {
    const result = await notifyFamilyFriendInvite({
      ...BASE_INPUT,
      toFamilyId: undefined,
      targetAdminUid: undefined,
    });

    expect(mockInviteEmailEnabled).not.toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ inApp: true, email: true, emailOptedOut: false });
  });

  it("reports a delivery failure when the provider throws", async () => {
    mockSend.mockRejectedValue(new Error("SES_DOWN"));

    const result = await notifyFamilyFriendInvite(BASE_INPUT);

    expect(result).toEqual({ inApp: true, email: false, emailOptedOut: false });
  });
});
