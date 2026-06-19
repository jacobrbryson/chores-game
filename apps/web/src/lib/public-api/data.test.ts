import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const adminGetDocument = vi.fn();
const adminListDocuments = vi.fn();
const adminListAllDocuments = vi.fn();

vi.mock("@/lib/firestore/admin", () => ({
  adminGetDocument: (...args: unknown[]) => adminGetDocument(...args),
  adminListDocuments: (...args: unknown[]) => adminListDocuments(...args),
  adminListAllDocuments: (...args: unknown[]) => adminListAllDocuments(...args),
}));

import { getPlayerChores } from "@/lib/public-api/data";
import type { ApiTokenRecord } from "@/lib/public-api/types";

function token(overrides: Partial<ApiTokenRecord> = {}): ApiTokenRecord {
  return {
    id: "token-1",
    userId: "parent-1",
    familyId: "family-1",
    tokenPrefix: "fc_live_abcd1234",
    tokenHash: "hash",
    name: "Assistant",
    status: "active",
    scopes: ["read:chores"],
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    lastUsedAt: "",
    disabledAt: "",
    deletedAt: "",
    regeneratedAt: "",
    expiresAt: "",
    createdIp: "",
    lastUsedIp: "",
    usageDay: "2026-06-16",
    usageCountToday: 0,
    lastUsedEndpoint: "",
    lastErrorAt: "",
    lastErrorCode: "",
    ...overrides,
  };
}

function memberDoc(id: string, fields: Record<string, unknown>) {
  return { name: `families/family-1/members/${id}`, fields: toFields(fields) };
}

function choreDoc(id: string, fields: Record<string, unknown>) {
  return { name: `families/family-1/chores/${id}`, fields: toFields(fields) };
}

function categoryDoc(id: string, fields: Record<string, unknown>) {
  return { name: `families/family-1/categories/${id}`, fields: toFields(fields) };
}

// Minimal Firestore REST value encoder for the fields the data layer reads.
function toFields(input: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "boolean") {
      out[key] = { booleanValue: value };
    } else if (typeof value === "number") {
      out[key] = { integerValue: String(value) };
    } else if (Array.isArray(value)) {
      out[key] = { arrayValue: { values: value.map((v) => ({ stringValue: String(v) })) } };
    } else if (key.endsWith("At") && typeof value === "string" && value) {
      out[key] = { timestampValue: value };
    } else {
      out[key] = { stringValue: String(value) };
    }
  }
  return out;
}

const PLAYER = "pip";

function defaultMembers() {
  return [
    memberDoc("parent-1", { uid: "parent-1", name: "Parent", email: "p@example.com", role: "admin", status: "active" }),
    memberDoc(PLAYER, { uid: "pip-uid", name: "Pip", email: "pip@example.com", role: "player", status: "active" }),
  ];
}

const categories = [
  categoryDoc("cat-viv", { name: "Vivacity", color: "#22c55e" }),
  categoryDoc("cat-home", { name: "Home", color: "#3b82f6" }),
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-16T12:00:00.000Z")); // Tuesday
  adminGetDocument.mockResolvedValue({ name: "users/parent-1", fields: toFields({ email: "p@example.com" }) });
  adminListDocuments.mockImplementation(async (path: string) => {
    if (path.endsWith("/members")) return defaultMembers();
    if (path.endsWith("/categories")) return categories;
    return [];
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("getPlayerChores", () => {
  it("returns today's still-to-do chores including those with no due date", async () => {
    adminListAllDocuments.mockResolvedValue([
      choreDoc("a", { title: "Dishes", status: "Open", dueDate: "2026-06-16", assigneeId: PLAYER, coinValue: 5 }),
      choreDoc("b", { title: "Anytime", status: "Open", dueDate: "", assigneeId: PLAYER, coinValue: 3 }),
      choreDoc("c", { title: "Tomorrow", status: "Open", dueDate: "2026-06-17", assigneeId: PLAYER, coinValue: 2 }),
      choreDoc("d", { title: "Other kid", status: "Open", dueDate: "2026-06-16", assigneeId: "someone", coinValue: 9 }),
    ]);

    const result = await getPlayerChores(token(), PLAYER, { range: "today", status: "open" });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.data.chores.map((c) => c.title).sort()).toEqual(["Anytime", "Dishes"]);
  });

  it("returns chores completed last week by completion date", async () => {
    adminListAllDocuments.mockResolvedValue([
      choreDoc("a", { title: "Last week", status: "Approved", submittedAt: "2026-06-10T09:00:00.000Z", assigneeId: PLAYER, coinValue: 5 }),
      choreDoc("b", { title: "This week", status: "Approved", submittedAt: "2026-06-16T09:00:00.000Z", assigneeId: PLAYER, coinValue: 5 }),
      choreDoc("c", { title: "Still open", status: "Open", dueDate: "2026-06-10", assigneeId: PLAYER, coinValue: 5 }),
    ]);

    const result = await getPlayerChores(token(), PLAYER, { range: "last-week", status: "completed" });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.data.chores.map((c) => c.title)).toEqual(["Last week"]);
    expect(result.data.chores[0].completed).toBe(true);
  });

  it("projects a recurring chore forward to answer tomorrow", async () => {
    adminListAllDocuments.mockResolvedValue([
      choreDoc("a", {
        title: "Feed the dog",
        status: "Open",
        dueDate: "2026-06-16",
        assigneeId: PLAYER,
        coinValue: 5,
        recurrenceType: "daily",
      }),
    ]);

    const result = await getPlayerChores(token(), PLAYER, { range: "tomorrow" });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.data.chores).toHaveLength(1);
    expect(result.data.chores[0]).toMatchObject({ title: "Feed the dog", dueDate: "2026-06-17", projected: true });
  });

  it("filters by category name (case-insensitive)", async () => {
    adminListAllDocuments.mockResolvedValue([
      choreDoc("a", { title: "Read a book", status: "Open", assigneeId: PLAYER, categoryIds: ["cat-viv"], coinValue: 5 }),
      choreDoc("b", { title: "Sweep", status: "Open", assigneeId: PLAYER, categoryIds: ["cat-home"], coinValue: 5 }),
    ]);

    const result = await getPlayerChores(token(), PLAYER, { category: "vivacity" });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.data.chores.map((c) => c.title)).toEqual(["Read a book"]);
    expect(result.data.chores[0].categories[0].name).toBe("Vivacity");
  });

  it("denies access to a player not visible to a child token", async () => {
    adminGetDocument.mockResolvedValue({ name: "users/pip-uid", fields: toFields({ email: "pip@example.com" }) });
    adminListAllDocuments.mockResolvedValue([]);
    const childToken = token({ userId: "pip-uid" });

    const result = await getPlayerChores(childToken, "parent-1", { range: "today" });
    expect(result.status).toBe("permission_denied");
  });
});
