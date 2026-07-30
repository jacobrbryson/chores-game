import type { APIRequestContext, Page } from "@playwright/test";
import { expect } from "./test";
import { E2E_TEST_DATA } from "./env";

type CreateChoreOptions = {
  title: string;
  assigneeId?: string;
  assigneeIds?: string[];
  assigneeScope?: "single" | "multiple" | "family";
  coinValue?: number;
  requireApproval?: boolean;
};

async function parseJson(response: Awaited<ReturnType<APIRequestContext["post"]>>) {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

export async function createChore(request: APIRequestContext, options: CreateChoreOptions) {
  const assigneeIds = options.assigneeIds ?? [
    options.assigneeId ?? E2E_TEST_DATA.child.memberId,
  ];
  const response = await request.post("/api/chores", {
    data: {
      description: options.title,
      assigneeIds,
      assigneeScope:
        options.assigneeScope ?? (assigneeIds.length > 1 ? "multiple" : "single"),
      coinValue: options.coinValue ?? 5,
      requireApproval: options.requireApproval ?? true,
    },
  });
  const payload = await parseJson(response);
  expect(response.ok(), JSON.stringify(payload)).toBeTruthy();
  const createdChoreIds = payload.createdChoreIds;
  expect(Array.isArray(createdChoreIds)).toBeTruthy();
  return String((createdChoreIds as string[])[0]);
}

export async function completeChore(request: APIRequestContext, choreId: string) {
  const response = await request.patch(`/api/chores/${choreId}`, {
    data: { action: "complete" },
  });
  const payload = await parseJson(response);
  expect(response.ok(), JSON.stringify(payload)).toBeTruthy();
}

export async function approveChore(request: APIRequestContext, choreId: string) {
  const response = await request.patch(`/api/chores/${choreId}`, {
    data: { action: "approve" },
  });
  const payload = await parseJson(response);
  expect(response.ok(), JSON.stringify(payload)).toBeTruthy();
}

export async function expectChoreVisible(page: Page, title: string) {
  await expect(page.getByText(title, { exact: false })).toBeVisible();
}

export async function openChoresPage(page: Page) {
  await page.goto("/chores");
  await expect(page.getByRole("heading", { name: /chores/i })).toBeVisible();
}

export async function openFamilyPrivacy(page: Page) {
  await page.goto("/family?tab=privacy");
  await expect(page.getByRole("button", { name: /privacy/i })).toBeVisible();
  await page.getByRole("button", { name: /privacy/i }).click();
  await expect(page.getByRole("heading", { name: /privacy overview/i })).toBeVisible();
}

export function uniqueTitle(prefix: string) {
  return `${prefix} ${Date.now()} ${Math.random().toString(36).slice(2, 7)}`;
}
