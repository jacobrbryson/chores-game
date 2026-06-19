import { describe, expect, it } from "vitest";
import {
  athenaToGhostSuggestion,
  normalizeAthenaSuggestion,
  parseAthenaGhostResponse,
  type AthenaGhostSuggestion,
} from "@/lib/integrations/ghost-chore-schema";

const VALID = {
  title: "Wipe the bathroom sink",
  description: "Clear the counter and wipe the sink after brushing teeth.",
  difficulty: "easy",
  estimatedMinutes: 5,
  suggestedCoins: 5,
  category: "Self Care",
  pillar: "Home Care",
  suggestionType: "next_step",
  reason: "Builds on their brushing-teeth chore.",
  confidence: 0.86,
  requiresParentReview: true,
  safetyNotes: null,
};

describe("normalizeAthenaSuggestion", () => {
  it("accepts and clamps a valid suggestion", () => {
    const out = normalizeAthenaSuggestion(VALID, { forceParentReview: false })!;
    expect(out.title).toBe("Wipe the bathroom sink");
    expect(out.difficulty).toBe("easy");
    expect(out.suggestionType).toBe("next_step");
    expect(out.confidence).toBe(0.86);
  });

  it("coerces invalid enums and out-of-range confidence to safe values", () => {
    const out = normalizeAthenaSuggestion(
      { ...VALID, difficulty: "extreme", suggestionType: "bogus", confidence: 9 },
      { forceParentReview: false },
    )!;
    expect(out.difficulty).toBe("easy");
    expect(out.suggestionType).toBe("novelty");
    expect(out.confidence).toBe(1);
  });

  it("rejects entries that fail the hard safety filter", () => {
    const out = normalizeAthenaSuggestion(
      { ...VALID, title: "Use the stove to cook dinner" },
      { forceParentReview: false },
    );
    expect(out).toBeNull();
  });

  it("rejects entries without a title", () => {
    expect(normalizeAthenaSuggestion({ description: "x" }, { forceParentReview: false })).toBeNull();
  });

  it("forces parent review for child subjects even when the model says false", () => {
    const out = normalizeAthenaSuggestion(
      { ...VALID, requiresParentReview: false },
      { forceParentReview: true },
    )!;
    expect(out.requiresParentReview).toBe(true);
  });
});

describe("parseAthenaGhostResponse", () => {
  it("parses a valid response with meta", () => {
    const { suggestions, meta } = parseAthenaGhostResponse(
      { suggestions: [VALID], meta: { source: "athena", modelVersion: "v1", generatedAt: "2026-06-18T00:00:00Z" } },
      { forceParentReview: false },
    );
    expect(suggestions).toHaveLength(1);
    expect(meta.source).toBe("athena");
    expect(meta.modelVersion).toBe("v1");
  });

  it("returns an empty list for an empty response (caller falls back)", () => {
    expect(parseAthenaGhostResponse({ suggestions: [] }, { forceParentReview: false }).suggestions).toEqual([]);
  });

  it("returns an empty list for a malformed/invalid response", () => {
    expect(parseAthenaGhostResponse("not an object", { forceParentReview: false }).suggestions).toEqual([]);
    expect(parseAthenaGhostResponse({ nope: true }, { forceParentReview: false }).suggestions).toEqual([]);
    expect(
      parseAthenaGhostResponse({ suggestions: [{ junk: 1 }, null, 3] }, { forceParentReview: false }).suggestions,
    ).toEqual([]);
  });

  it("synthesizes meta when missing", () => {
    const { meta } = parseAthenaGhostResponse({ suggestions: [VALID] }, { forceParentReview: false });
    expect(meta.source).toBe("athena");
    expect(meta.modelVersion).toBe("unknown");
    expect(typeof meta.generatedAt).toBe("string");
  });
});

describe("athenaToGhostSuggestion", () => {
  it("maps onto the GhostChoreSuggestion shape with a deterministic athena id", () => {
    const athena = normalizeAthenaSuggestion(VALID, { forceParentReview: true }) as AthenaGhostSuggestion;
    const ghost = athenaToGhostSuggestion(athena);
    expect(ghost.source).toBe("athena");
    expect(ghost.id).toMatch(/^athena__/);
    expect(ghost.suggestedTitle).toBe("Wipe the bathroom sink");
    expect(ghost.athena?.requiresParentReview).toBe(true);
    expect(ghost.athena?.reason).toContain("brushing-teeth");
    // deterministic id (idempotent request/dismiss)
    expect(athenaToGhostSuggestion(athena).id).toBe(ghost.id);
  });
});
