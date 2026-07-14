import { describe, expect, it } from "vitest";
import { buildRewardClaimFields } from "@/lib/store/reward-redemption";

const baseInput = {
  rewardId: "movie-night",
  rewardDescription: "Movie night",
  rewardImageId: "movie_night",
  coinCost: 30,
  recipientUid: "child-1",
  recipientName: "Sam",
  recipientEmail: "sam@example.com",
  actorUid: "parent-1",
  actorName: "Parent",
  now: "2026-07-14T12:00:00.000Z",
};

describe("buildRewardClaimFields", () => {
  it("assigns an unclaimed reward to the selected recipient and audits the admin actor", () => {
    const fields = buildRewardClaimFields({ ...baseInput, consumed: false });

    expect(fields.purchaserUid).toEqual({ stringValue: "child-1" });
    expect(fields.status).toEqual({ stringValue: "unclaimed" });
    expect(fields.claimedAt).toBeUndefined();
    expect(fields.claimedByUid).toEqual({ stringValue: "" });
    expect(fields.redeemedByUid).toEqual({ stringValue: "parent-1" });
  });

  it("marks an immediately consumed reward claimed by the acting admin", () => {
    const fields = buildRewardClaimFields({ ...baseInput, consumed: true });

    expect(fields.status).toEqual({ stringValue: "claimed" });
    expect(fields.claimedAt).toEqual({ timestampValue: baseInput.now });
    expect(fields.claimedByUid).toEqual({ stringValue: "parent-1" });
    expect(fields.claimedByName).toEqual({ stringValue: "Parent" });
  });
});
