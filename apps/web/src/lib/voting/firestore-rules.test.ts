import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("voting Firestore rules", () => {
  it("denies direct client access to votes and vote aggregates", () => {
    const rules = readFileSync(path.resolve(process.cwd(), "firestore.rules"), "utf8");

    expect(rules).toContain("match /votes/{voteId}");
    expect(rules).toContain("match /voteAggregates/{aggregateId}");
    expect(rules).toContain("allow read, write: if false;");
  });
});

