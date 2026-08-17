import { describe, expect, it } from "vitest";
import { resolveMobileAvatarUrl } from "./mobile-avatar-url";

const APP_ORIGIN = "http://192.168.1.25:3000";

describe("resolveMobileAvatarUrl", () => {
  it("resolves relative app avatars against the mobile app origin", () => {
    expect(resolveMobileAvatarUrl("/avatars/default/avatar-04.png", APP_ORIGIN)).toBe(
      "http://192.168.1.25:3000/avatars/default/avatar-04.png",
    );
  });

  it("re-homes app avatars generated with an unreachable server host", () => {
    expect(
      resolveMobileAvatarUrl(
        "http://localhost:3000/avatars/default/avatar-09.png",
        APP_ORIGIN,
      ),
    ).toBe("http://192.168.1.25:3000/avatars/default/avatar-09.png");
  });

  it("does not rewrite custom or identity-provider photo URLs", () => {
    const remoteUrl = "https://images.example.com/family/avatar.png";
    expect(resolveMobileAvatarUrl(remoteUrl, APP_ORIGIN)).toBe(remoteUrl);
  });
});
