import { describe, expect, it, vi } from "vitest";

const { mockSendWeekly } = vi.hoisted(() => ({
  mockSendWeekly: vi.fn(),
}));

vi.mock("@/lib/newsletters/service", () => ({
  sendWeeklyFamilyHighlightsForAllFamilies: mockSendWeekly,
}));

import { POST } from "@/app/api/internal/newsletters/weekly/send/route";

describe("POST /api/internal/newsletters/weekly/send", () => {
  it("requires the internal secret", async () => {
    process.env.NEWSLETTER_INTERNAL_SECRET = "secret-1";
    const response = await POST(new Request("http://localhost/api/internal/newsletters/weekly/send", { method: "POST" }) as any);

    expect(response.status).toBe(401);
  });

  it("runs the scheduled send when authorized", async () => {
    process.env.NEWSLETTER_INTERNAL_SECRET = "secret-1";
    mockSendWeekly.mockResolvedValue({ sent: 1, failed: 0, skipped: 0, records: [] });

    const response = await POST(new Request("http://localhost/api/internal/newsletters/weekly/send", {
      method: "POST",
      headers: { authorization: "Bearer secret-1" },
    }) as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.sent).toBe(1);
  });
});
