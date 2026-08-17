import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The profile-switch / Kiosk Mode PIN is written to users/{uid} by
// setAccountSwitchPin. Firestore rules validate self-updates against per-purpose
// field allowlists, so a PIN write is rejected unless its fields appear in one of
// them. They did not, which meant no PIN could ever be stored: "Switch To..."
// always returned pin_not_configured and Kiosk Mode exited without a prompt.
describe("account switch PIN Firestore rules", () => {
  const rules = readFileSync(path.resolve(process.cwd(), "firestore.rules"), "utf8");

  it("allows the owning account to write its own PIN fields", () => {
    expect(rules).toContain("function isValidSelfUserAccountSwitchPinUpdate(uid)");
    expect(rules).toContain("accountSwitchPinHash");
    expect(rules).toContain("accountSwitchPinUpdatedAt");
  });

  it("wires the PIN update into the self-update allowlist", () => {
    expect(rules).toContain("|| isValidSelfUserAccountSwitchPinUpdate(uid)");
  });

  it("keeps the PIN rule scoped to the owner only", () => {
    const start = rules.indexOf("function isValidSelfUserAccountSwitchPinUpdate(uid)");
    const body = rules.slice(start, rules.indexOf("\n    }", start));
    expect(body).toContain("isSelf(uid)");
    // A second family admin must never be able to set or clear someone else's PIN.
    expect(body).not.toContain("canAdminManageUser");
  });
});
