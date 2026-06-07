import { createHmac } from "node:crypto";
import type { Page } from "@playwright/test";
import { E2E_TEST_DATA, type E2ERole, type E2EUser } from "./env";

function sessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters for E2E auth.");
  }
  return secret;
}

function sign(value: string) {
  return createHmac("sha256", sessionSecret()).update(value).digest("base64url");
}

function createSessionCookie(user: E2EUser) {
  const payload = {
    uid: user.uid,
    memberId: user.memberId || user.uid,
    role: user.role,
    email: user.email,
    name: user.name,
    picture: user.picture,
    locale: user.locale,
    firebaseIdToken: user.firebaseIdToken,
    firebaseRefreshToken: user.firebaseRefreshToken,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export async function loginAs(page: Page, role: E2ERole) {
  const user = E2E_TEST_DATA[role];
  await page.context().clearCookies();
  await page.context().addCookies([
    {
      name: "session_user",
      value: createSessionCookie(user),
      url: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
      httpOnly: true,
      sameSite: "Lax",
      secure: false,
    },
  ]);
}

export async function loginAsParent(page: Page) {
  await loginAs(page, "parent");
}

export async function loginAsChild(page: Page) {
  await loginAs(page, "child");
}

export async function loginAsSupport(page: Page) {
  await loginAs(page, "support");
}
