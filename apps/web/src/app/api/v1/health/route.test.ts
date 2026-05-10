import { describe, expect, it } from "vitest";
import { buildHealthPayload } from "./route";

describe("v1 health", () => {
  it("returns expected fields", () => {
    const payload = buildHealthPayload();
    expect(payload.status).toBe("ok");
    expect(payload.version).toBe("v1");
  });
});
