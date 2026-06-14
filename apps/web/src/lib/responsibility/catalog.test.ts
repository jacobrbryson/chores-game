import { describe, expect, it } from "vitest";
import { filterChoreSuggestions, type ChoreSuggestion } from "./catalog";

function suggestion(overrides: Partial<ChoreSuggestion>): ChoreSuggestion {
  return {
    id: "s1",
    title: "Unload dishwasher",
    pillar: "home_care",
    minAge: 6,
    maxAge: 12,
    difficulty: "easy",
    estimatedMinutes: 10,
    popularity: 5,
    active: true,
    ...overrides,
  };
}

describe("filterChoreSuggestions", () => {
  const catalog: ChoreSuggestion[] = [
    suggestion({ id: "a", title: "Unload dishwasher", pillar: "home_care", popularity: 10 }),
    suggestion({
      id: "b",
      title: "Cook dinner",
      pillar: "life_skills",
      minAge: 10,
      maxAge: 18,
      difficulty: "hard",
      estimatedMinutes: 45,
      popularity: 7,
    }),
    suggestion({ id: "c", title: "Make bed", pillar: "self_care", minAge: 4, maxAge: 8, popularity: 9 }),
    suggestion({ id: "d", title: "Retired idea", active: false, popularity: 99 }),
  ];

  it("excludes inactive suggestions", () => {
    const result = filterChoreSuggestions(catalog, {});
    expect(result.map((entry) => entry.id)).not.toContain("d");
  });

  it("filters by pillar", () => {
    const result = filterChoreSuggestions(catalog, { pillar: "life_skills" });
    expect(result.map((entry) => entry.id)).toEqual(["b"]);
  });

  it("filters by age range inclusively", () => {
    expect(filterChoreSuggestions(catalog, { age: 10 }).map((e) => e.id)).toEqual(["a", "b"]);
    expect(filterChoreSuggestions(catalog, { age: 5 }).map((e) => e.id)).toEqual(["c"]);
  });

  it("filters by difficulty and estimated time", () => {
    expect(filterChoreSuggestions(catalog, { difficulty: "hard" }).map((e) => e.id)).toEqual(["b"]);
    expect(filterChoreSuggestions(catalog, { maxMinutes: 15 }).map((e) => e.id)).toEqual([
      "a",
      "c",
    ]);
  });

  it("sorts by popularity descending", () => {
    expect(filterChoreSuggestions(catalog, {}).map((entry) => entry.id)).toEqual(["a", "c", "b"]);
  });
});
