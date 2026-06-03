import { describe, expect, it } from "vitest";
import {
  filterAndSortPublicCommunityAwards,
  normalizeCommunityAwardImage,
  normalizeCommunityAwardTags,
  toPublicCommunityAward,
  type CommunityAwardRecord,
} from "@/lib/community-awards";

function record(patch: Partial<CommunityAwardRecord>): CommunityAwardRecord {
  return {
    id: "award-1",
    sourceFamilyId: "family-private",
    sourceRewardId: "reward-private",
    sourceSubmittedByUid: "uid-private",
    sourceTitle: "Private source title",
    sourceDescription: "Private source description",
    sourceCoinAmount: 10,
    sourceImage: "screen_time",
    sourceCreatedAt: "2026-06-01T00:00:00.000Z",
    publicTitle: "Extra reading time",
    publicDescription: "A quiet reward idea.",
    publicCoinAmount: 20,
    publicImage: "screen_time",
    publicImagePath: "/rewards/screens.png",
    publicCategory: "learning",
    publicTags: ["books"],
    status: "approved",
    rejectionReason: "private rejection",
    internalModerationNotes: "private note",
    reviewedByUid: "support-private",
    reviewedByEmail: "support@example.com",
    reviewedAt: "2026-06-02T00:00:00.000Z",
    approvedAt: "2026-06-02T00:00:00.000Z",
    hiddenAt: "",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-02T00:00:00.000Z",
    voteCount: 2,
    copyCount: 3,
    ...patch,
  };
}

describe("community awards", () => {
  it("normalizes tags and rejects unsafe images", () => {
    expect(normalizeCommunityAwardTags(" Fun, Family, Fun ")).toEqual(["fun", "family", "fun"]);
    expect(normalizeCommunityAwardImage("https://example.com/image.png")).toBe("screen_time");
    expect(normalizeCommunityAwardImage("/rewards/icecream.png")).toBe("ice_cream");
  });

  it("returns approved awards only and supports search and sorting", () => {
    const rows = [
      record({ id: "low", publicTitle: "Movie night", voteCount: 1, copyCount: 10 }),
      record({ id: "high", publicTitle: "Museum trip", voteCount: 5, copyCount: 1 }),
      record({ id: "hidden", publicTitle: "Museum secret", status: "hidden", voteCount: 99 }),
    ];

    expect(filterAndSortPublicCommunityAwards(rows, { search: "museum", sort: "most_popular" }).map((row) => row.id)).toEqual(["high"]);
    expect(filterAndSortPublicCommunityAwards(rows, { sort: "most_copied" }).map((row) => row.id)).toEqual(["low", "high"]);
  });

  it("omits source and moderation fields from public awards", () => {
    const publicAward = toPublicCommunityAward(record({}), 1);
    expect(publicAward).toEqual({
      id: "award-1",
      publicTitle: "Extra reading time",
      publicDescription: "A quiet reward idea.",
      publicCoinAmount: 20,
      publicImage: "screen_time",
      publicImagePath: "/rewards/screens.png",
      publicCategory: "learning",
      publicTags: ["books"],
      voteCount: 2,
      copyCount: 3,
      approvedAt: "2026-06-02T00:00:00.000Z",
      createdAt: "2026-06-01T00:00:00.000Z",
      viewerVote: 1,
    });
    expect("sourceFamilyId" in publicAward).toBe(false);
    expect("internalModerationNotes" in publicAward).toBe(false);
    expect("rejectionReason" in publicAward).toBe(false);
  });
});
