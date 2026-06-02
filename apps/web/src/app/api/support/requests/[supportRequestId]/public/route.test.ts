import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetSessionFromRequest,
  mockIsSupportAdmin,
  mockAdminGetDocument,
  mockAdminCommitWrites,
  mockLoadSupportRequestDetail,
  mockWritePublicRequestedChangesSnapshotBestEffort,
} = vi.hoisted(() => ({
  mockGetSessionFromRequest: vi.fn(),
  mockIsSupportAdmin: vi.fn(),
  mockAdminGetDocument: vi.fn(),
  mockAdminCommitWrites: vi.fn(),
  mockLoadSupportRequestDetail: vi.fn(),
  mockWritePublicRequestedChangesSnapshotBestEffort: vi.fn(),
}));

vi.mock("@/lib/auth/request-session", () => ({ getSessionFromRequest: mockGetSessionFromRequest }));
vi.mock("@/lib/support/access", () => ({ isSupportAdmin: mockIsSupportAdmin }));
vi.mock("@/lib/support/management", () => ({ loadSupportRequestDetail: mockLoadSupportRequestDetail }));
vi.mock("@/lib/support/public-requests-snapshot", () => ({
  writePublicRequestedChangesSnapshotBestEffort: mockWritePublicRequestedChangesSnapshotBestEffort,
}));
vi.mock("@/lib/firestore/admin", () => ({
  adminGetDocument: mockAdminGetDocument,
  adminCommitWrites: mockAdminCommitWrites,
}));
vi.mock("@/lib/firestore/rest", async () => {
  const actual = await vi.importActual<typeof import("@/lib/firestore/rest")>("@/lib/firestore/rest");
  return {
    ...actual,
    readString: (fields: Record<string, { stringValue?: string }> | undefined, key: string) =>
      fields?.[key]?.stringValue ?? "",
    readTimestamp: (fields: Record<string, { timestampValue?: string; stringValue?: string }> | undefined, key: string) =>
      fields?.[key]?.timestampValue ?? fields?.[key]?.stringValue ?? "",
    readBoolean: (fields: Record<string, { booleanValue?: boolean }> | undefined, key: string) =>
      Boolean(fields?.[key]?.booleanValue),
  };
});

import { PATCH } from "@/app/api/support/requests/[supportRequestId]/public/route";

const session = { uid: "support-1", email: "support@example.com", name: "Support" };

function req(body: unknown) {
  return { json: async () => body } as never;
}

function ctx(id = "req-1") {
  return { params: Promise.resolve({ supportRequestId: id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-02T12:00:00.000Z"));
  mockGetSessionFromRequest.mockReturnValue(session);
  mockIsSupportAdmin.mockReturnValue(true);
  mockAdminGetDocument.mockResolvedValue({
    fields: {
      id: { stringValue: "req-1" },
      familyId: { stringValue: "fam-1" },
      createdByUid: { stringValue: "user-1" },
      createdByEmail: { stringValue: "parent@example.com" },
      createdByDisplayName: { stringValue: "Kid One" },
      status: { stringValue: "triaged" },
      deleted: { booleanValue: false },
      isPublic: { booleanValue: false },
    },
  });
  mockAdminCommitWrites.mockResolvedValue(undefined);
  mockWritePublicRequestedChangesSnapshotBestEffort.mockResolvedValue(undefined);
  mockLoadSupportRequestDetail.mockResolvedValue({
    request: {
      id: "req-1",
      familyId: "fam-1",
      isPublic: true,
      publicTitle: "Public title",
      publicDescription: "Curated public copy",
      publicStatus: "under_review",
    },
    history: [{ id: "h1" }],
  });
});

describe("PATCH /api/support/requests/[id]/public", () => {
  it("allows support operators to publish curated public copy", async () => {
    const res = await PATCH(
      req({
        familyId: "fam-1",
        isPublic: true,
        publicTitle: "Public title",
        publicDescription: "Curated public copy",
        publicStatus: "planned",
      }),
      ctx(),
    );

    expect(res.status).toBe(200);
    const writes = mockAdminCommitWrites.mock.calls[0][0];
    expect(writes[0].update.fields.isPublic).toEqual({ booleanValue: true });
    expect(writes[0].update.fields.publicTitle).toEqual({ stringValue: "Public title" });
    expect(writes[0].update.fields.publicDescription).toEqual({ stringValue: "Curated public copy" });
    expect(JSON.stringify(writes)).not.toContain("createdByEmail");
    expect(mockWritePublicRequestedChangesSnapshotBestEffort).toHaveBeenCalledTimes(1);
  });

  it("blocks regular users", async () => {
    mockIsSupportAdmin.mockReturnValue(false);
    const res = await PATCH(req({ familyId: "fam-1", isPublic: true }), ctx());
    expect(res.status).toBe(403);
    expect(mockAdminCommitWrites).not.toHaveBeenCalled();
  });

  it("rejects public copy that includes obvious private reporter data", async () => {
    const res = await PATCH(
      req({
        familyId: "fam-1",
        isPublic: true,
        publicTitle: "Public title",
        publicDescription: "Email parent@example.com about this",
        publicStatus: "under_review",
      }),
      ctx(),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("public_copy_contains_private_info");
    expect(mockAdminCommitWrites).not.toHaveBeenCalled();
  });
});
