import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("ChangeLogPage source", () => {
  it("renders grouped change log views from the validated data set", () => {
    const sourcePath = path.resolve(process.cwd(), "src/components/change-log-page.tsx");
    const source = readFileSync(sourcePath, "utf8");

    expect(source).toContain("const groups = getChangeLogEntryGroups()");
    expect(source).toContain("const group = getChangeLogEntryGroup(date)");
    expect(source).toContain('href={`/change-log/${group.date}`}');
    expect(source).toContain("group.entries.map((entry) =>");
    expect(source).toContain("entry.subject");
    expect(source).toContain("entry.description");
    expect(source).toContain("entry.image");
  });
});
