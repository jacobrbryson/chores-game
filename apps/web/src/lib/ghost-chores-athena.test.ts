import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Mock the boundaries getGhostSuggestionsForViewer touches -----------------
vi.mock("@/lib/integrations/athena", () => ({
  isAthenaConfigured: vi.fn(() => true),
  suggestGhostChoresWithAthena: vi.fn(),
  AthenaIntegrationError: class AthenaIntegrationError extends Error {
    code = "upstream_error";
  },
}));
vi.mock("@/lib/integrations/athena-store", () => ({
  getAthenaConnection: vi.fn(),
}));
vi.mock("@/lib/ghost-chore-cache", () => ({
  getGhostChoreCache: vi.fn(async () => null),
  isCacheFresh: vi.fn(() => false),
  saveGhostChoreCache: vi.fn(async () => {}),
  findCachedSuggestion: vi.fn(() => null),
}));
vi.mock("@/lib/observability/metrics", () => ({ recordOperationMetric: vi.fn(async () => {}) }));
vi.mock("@/lib/firestore/admin", () => ({
  adminGetDocument: vi.fn(),
  adminListAllDocuments: vi.fn(async () => []),
  adminListDocuments: vi.fn(async () => []),
  adminCreateOrReplaceDocument: vi.fn(async () => {}),
  adminPatchDocument: vi.fn(async () => {}),
}));

import { getGhostSuggestionsForViewer } from "@/lib/ghost-chores-service";
import { getAthenaConnection } from "@/lib/integrations/athena-store";
import { suggestGhostChoresWithAthena } from "@/lib/integrations/athena";
import { saveGhostChoreCache } from "@/lib/ghost-chore-cache";
import { adminGetDocument } from "@/lib/firestore/admin";

const FAMILY_ID = "fam1";
const SUBJECT_ID = "child1";

const context = {
  familyId: FAMILY_ID,
  memberId: SUBJECT_ID,
  role: "player" as const,
  aliases: [SUBJECT_ID],
  openChoreCount: 0,
  openChoreKeys: new Set<string>(),
  ownedChoreKeys: new Set<string>(),
};

function memberDoc() {
  return {
    name: `families/${FAMILY_ID}/members/${SUBJECT_ID}`,
    fields: {
      role: { stringValue: "player" },
      name: { stringValue: "Sam" },
      uid: { stringValue: "" },
      email: { stringValue: "" },
      birthYear: { integerValue: "2016" },
      createdAt: { timestampValue: "2026-01-01T00:00:00Z" },
      deleted: { booleanValue: false },
    },
  };
}

const ATHENA_OK = {
  suggestions: [
    {
      title: "Wipe the bathroom sink",
      description: "Clear the counter and wipe the sink.",
      difficulty: "easy",
      estimatedMinutes: 5,
      suggestedCoins: 5,
      category: "Self Care",
      pillar: "Home Care",
      suggestionType: "next_step",
      reason: "Builds on a recent chore.",
      confidence: 0.9,
      requiresParentReview: true,
      safetyNotes: null,
    },
  ],
  meta: { source: "athena", modelVersion: "v1", generatedAt: "2026-06-18T00:00:00Z" },
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: gather's member lookup + family doc succeed.
  vi.mocked(adminGetDocument).mockImplementation(async (path: string) => {
    if (path.includes("/members/")) return memberDoc() as never;
    if (path === `families/${FAMILY_ID}`) return { name: path, fields: {} } as never;
    const err = new Error("FIRESTORE_ADMIN_HTTP_404");
    throw err;
  });
});

describe("getGhostSuggestionsForViewer Athena integration", () => {
  it("uses Athena when connected and it returns valid suggestions", async () => {
    vi.mocked(getAthenaConnection).mockResolvedValue({ connected: true } as never);
    vi.mocked(suggestGhostChoresWithAthena).mockResolvedValue(ATHENA_OK);

    const result = await getGhostSuggestionsForViewer(context, 6);
    expect(result.source).toBe("athena");
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.suggestions[0].source).toBe("athena");
    expect(saveGhostChoreCache).toHaveBeenCalledOnce();
  });

  it("uses the local engine when Athena is not connected", async () => {
    vi.mocked(getAthenaConnection).mockResolvedValue({ connected: false } as never);

    const result = await getGhostSuggestionsForViewer(context, 6);
    expect(result.source).toBe("local");
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(suggestGhostChoresWithAthena).not.toHaveBeenCalled();
  });

  it("falls back to local when Athena throws", async () => {
    vi.mocked(getAthenaConnection).mockResolvedValue({ connected: true } as never);
    vi.mocked(suggestGhostChoresWithAthena).mockRejectedValue(new Error("boom"));

    const result = await getGhostSuggestionsForViewer(context, 6);
    expect(result.source).toBe("local");
    expect(result.suggestions.length).toBeGreaterThan(0);
  });

  it("falls back to local on an invalid Athena response", async () => {
    vi.mocked(getAthenaConnection).mockResolvedValue({ connected: true } as never);
    vi.mocked(suggestGhostChoresWithAthena).mockResolvedValue({ garbage: true });

    const result = await getGhostSuggestionsForViewer(context, 6);
    expect(result.source).toBe("local");
  });

  it("falls back to local on an empty Athena response", async () => {
    vi.mocked(getAthenaConnection).mockResolvedValue({ connected: true } as never);
    vi.mocked(suggestGhostChoresWithAthena).mockResolvedValue({ suggestions: [], meta: {} });

    const result = await getGhostSuggestionsForViewer(context, 6);
    expect(result.source).toBe("local");
  });
});
