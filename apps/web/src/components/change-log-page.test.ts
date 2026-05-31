import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("ChangeLogPage source", () => {
  it("renders change log entries from the validated data set", () => {
    const sourcePath = path.resolve(process.cwd(), "src/components/change-log-page.tsx");
    const source = readFileSync(sourcePath, "utf8");

    expect(source).toContain("const entries = getChangeLogEntries()");
    expect(source).toContain("entries.map((entry) =>");
    expect(source).toContain("entry.subject");
    expect(source).toContain("entry.description");
    expect(source).toContain("entry.image");
  });
});
