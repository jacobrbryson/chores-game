import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value);
    }),
  },
}));

import {
  loadApprovalCaughtUpDismissed,
  saveApprovalCaughtUpDismissed,
} from "./mobile-preferences";

describe("mobile approval caught-up preference", () => {
  beforeEach(() => {
    storage.clear();
  });

  it("persists dismissal across dashboard remounts", async () => {
    expect(await loadApprovalCaughtUpDismissed("parent-1")).toBe(false);

    await saveApprovalCaughtUpDismissed("parent-1", true);

    expect(await loadApprovalCaughtUpDismissed("parent-1")).toBe(true);
  });

  it("keeps each viewer's dismissal independent and can re-arm it", async () => {
    await saveApprovalCaughtUpDismissed("parent-1", true);
    expect(await loadApprovalCaughtUpDismissed("parent-2")).toBe(false);

    await saveApprovalCaughtUpDismissed("parent-1", false);

    expect(await loadApprovalCaughtUpDismissed("parent-1")).toBe(false);
  });
});
