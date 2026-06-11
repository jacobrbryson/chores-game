import type { APIRequestContext, Page } from "@playwright/test";
import { expect } from "./test";

async function parseJson(response: Awaited<ReturnType<APIRequestContext["post"]>>) {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

// Enter Kiosk Mode for the given roster of player member ids. `pin` is the
// authenticated account's profile-switch PIN (empty when none is configured).
export async function startKiosk(
  request: APIRequestContext,
  playerIds: string[],
  pin = "",
) {
  const response = await request.post("/api/kiosk/start", { data: { playerIds, pin } });
  const payload = await parseJson(response);
  expect(response.ok(), JSON.stringify(payload)).toBeTruthy();
}

export async function switchKiosk(request: APIRequestContext, playerId: string) {
  const response = await request.post("/api/kiosk/switch", { data: { playerId } });
  const payload = await parseJson(response);
  expect(response.ok(), JSON.stringify(payload)).toBeTruthy();
  return response;
}

export async function stopKiosk(request: APIRequestContext, pin = "") {
  const response = await request.post("/api/kiosk/stop", { data: { pin } });
  const payload = await parseJson(response);
  expect(response.ok(), JSON.stringify(payload)).toBeTruthy();
}

// Reads a family member's current coin balance from the family summary (the same
// source the kiosk header uses). Used to prove a kiosk completion is credited to
// the selected player and not the authenticated account.
export async function getMemberCoins(request: APIRequestContext, memberId: string) {
  const response = await request.get("/api/family/summary");
  const payload = await parseJson(response);
  const members = Array.isArray(payload.members)
    ? (payload.members as Array<{ id?: string; stats?: { currentCoins?: number } }>)
    : [];
  const member = members.find((entry) => entry?.id === memberId);
  return Number(member?.stats?.currentCoins ?? 0);
}

// Drives the real "Switch To…" profile-menu dialog to enter Kiosk Mode for a
// single player (exercises the dialog integration end to end). Assumes no PIN is
// configured on the authenticated account.
export async function enterKioskViaDialog(page: Page, memberName: string) {
  await page.getByRole("button", { name: "Open profile menu" }).click();
  await page.getByRole("button", { name: "Switch To..." }).click();
  await page.getByRole("tab", { name: "Kiosk Mode" }).click();
  await page
    .locator(".switch-member-option")
    .filter({ has: page.getByText(memberName, { exact: true }) })
    .click();
  await page.getByRole("button", { name: "Start Kiosk Mode" }).click();
  await expect(page).toHaveURL(/\/kiosk(\?|\/|$)/);
}
