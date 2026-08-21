import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.PUSH_SUBSCRIPTION_SECRET =
  process.env.PUSH_SUBSCRIPTION_SECRET || "test-push-encryption-secret";

const { mockListDocuments, mockDeleteDocument, mockSendWebPushNotification, mockIsWebPushConfigured } =
  vi.hoisted(() => ({
    mockListDocuments: vi.fn(),
    mockDeleteDocument: vi.fn(),
    mockSendWebPushNotification: vi.fn(),
    mockIsWebPushConfigured: vi.fn(),
  }));

vi.mock("@/lib/firestore/rest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/firestore/rest")>();
  return {
    ...actual,
    listDocuments: mockListDocuments,
    deleteDocument: mockDeleteDocument,
  };
});

vi.mock("@/lib/push/web-push", () => ({
  isWebPushConfigured: mockIsWebPushConfigured,
  sendWebPushNotification: mockSendWebPushNotification,
}));

import { normalizePushNotificationSettings } from "@/lib/push/constants";
import { buildStoredPushDeviceFields, pushDeviceDocumentId } from "@/lib/push/devices";

const EXPO_TOKEN_A = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]";
const EXPO_TOKEN_B = "ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]";

function deviceDoc(input: {
  uid: string;
  expoPushToken: string;
  achievementUnlocked: boolean;
}) {
  return {
    name: `projects/p/databases/(default)/documents/families/fam-1/pushDevices/${pushDeviceDocumentId(input.expoPushToken)}`,
    fields: buildStoredPushDeviceFields({
      familyId: "fam-1",
      uid: input.uid,
      platform: "android",
      permission: "granted",
      settings: normalizePushNotificationSettings({
        achievementUnlocked: input.achievementUnlocked,
      }),
      expoPushToken: input.expoPushToken,
      now: "2026-08-21T10:00:00.000Z",
    }),
  };
}

function mockExpoResponse(tickets: Array<Record<string, unknown>>) {
  return vi.fn(async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify({ data: tickets }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("achievement unlock push delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // No VAPID keys in tests: the native transport must still run, which is the
    // whole point of keeping the two independent.
    mockIsWebPushConfigured.mockReturnValue(false);
    mockDeleteDocument.mockResolvedValue(undefined);
  });

  it("sends only to the earner's devices that opted into achievement pushes", async () => {
    mockListDocuments.mockImplementation(async (path: string) => {
      if (path.endsWith("/pushDevices")) {
        return [
          deviceDoc({ uid: "player-1", expoPushToken: EXPO_TOKEN_A, achievementUnlocked: true }),
          // Same family, different member — must not receive the unlock.
          deviceDoc({ uid: "player-2", expoPushToken: EXPO_TOKEN_B, achievementUnlocked: true }),
        ];
      }
      return [];
    });
    const fetchMock = mockExpoResponse([{ status: "ok" }]);
    vi.stubGlobal("fetch", fetchMock);

    const { sendAchievementUnlockedPush } = await import("@/lib/push/delivery");
    await sendAchievementUnlockedPush({
      familyId: "fam-1",
      idToken: "token",
      uid: "player-1",
      title: "Achievement Unlocked",
      body: "Tiny chore, huge legend",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestInit = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(requestInit?.body)) as Array<{
      to: string;
      data: { url: string };
    }>;
    expect(body).toHaveLength(1);
    expect(body[0].to).toBe(EXPO_TOKEN_A);
    expect(body[0].data.url).toBe("/achievements");
    vi.unstubAllGlobals();
  });

  it("skips devices with the achievement toggle off", async () => {
    mockListDocuments.mockImplementation(async (path: string) =>
      path.endsWith("/pushDevices")
        ? [deviceDoc({ uid: "player-1", expoPushToken: EXPO_TOKEN_A, achievementUnlocked: false })]
        : [],
    );
    const fetchMock = mockExpoResponse([]);
    vi.stubGlobal("fetch", fetchMock);

    const { sendAchievementUnlockedPush } = await import("@/lib/push/delivery");
    await sendAchievementUnlockedPush({
      familyId: "fam-1",
      idToken: "token",
      uid: "player-1",
      title: "Achievement Unlocked",
      body: "Tiny chore, huge legend",
    });

    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("drops a registration Expo reports as uninstalled", async () => {
    mockListDocuments.mockImplementation(async (path: string) =>
      path.endsWith("/pushDevices")
        ? [deviceDoc({ uid: "player-1", expoPushToken: EXPO_TOKEN_A, achievementUnlocked: true })]
        : [],
    );
    const fetchMock = mockExpoResponse([
      { status: "error", message: "not registered", details: { error: "DeviceNotRegistered" } },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const { sendAchievementUnlockedPush } = await import("@/lib/push/delivery");
    await sendAchievementUnlockedPush({
      familyId: "fam-1",
      idToken: "token",
      uid: "player-1",
      title: "Achievement Unlocked",
      body: "Tiny chore, huge legend",
    });

    expect(mockDeleteDocument).toHaveBeenCalledWith(
      `families/fam-1/pushDevices/${pushDeviceDocumentId(EXPO_TOKEN_A)}`,
      "token",
    );
    vi.unstubAllGlobals();
  });
});
