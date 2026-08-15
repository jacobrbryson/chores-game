import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { resetAppleJwksCacheForTests, verifyAppleIdentityToken } from "./apple-token";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "apple-test-key", alg: "RS256" };
const rawNonce = "test-raw-nonce";
const hashedNonce = createHash("sha256").update(rawNonce).digest("hex");
const now = new Date("2026-08-13T12:00:00.000Z");

function token(overrides: Record<string, unknown> = {}) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: jwk.kid })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({
    iss: "https://appleid.apple.com",
    aud: "com.orcwood.familychores",
    exp: Math.floor(now.getTime() / 1000) + 600,
    nonce: hashedNonce,
    sub: "apple-user-1",
    email: "relay@privaterelay.appleid.com",
    ...overrides,
  })).toString("base64url");
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${claims}`), privateKey).toString("base64url");
  return `${header}.${claims}.${signature}`;
}

function appleJwksFetch() {
  return (async () => new Response(JSON.stringify({ keys: [jwk] }), {
    status: 200,
    headers: { "cache-control": "max-age=3600" },
  })) as typeof fetch;
}

describe("verifyAppleIdentityToken", () => {
  beforeEach(() => resetAppleJwksCacheForTests());

  it("accepts a valid signed token with an allowlisted audience and nonce", async () => {
    await expect(verifyAppleIdentityToken({
      idToken: token(), rawNonce, allowedAudiences: ["com.orcwood.familychores"],
      fetcher: appleJwksFetch(), now,
    })).resolves.toMatchObject({ subject: "apple-user-1", audience: "com.orcwood.familychores" });
  });

  it.each([
    ["wrong audience", { aud: "attacker.example" }, "APPLE_AUDIENCE_MISMATCH"],
    ["wrong issuer", { iss: "https://example.com" }, "APPLE_ISSUER_MISMATCH"],
    ["expired token", { exp: Math.floor(now.getTime() / 1000) - 1 }, "APPLE_TOKEN_EXPIRED"],
    ["bad nonce", { nonce: "not-the-hash" }, "APPLE_NONCE_MISMATCH"],
  ])("rejects %s", async (_label, claims, expectedError) => {
    await expect(verifyAppleIdentityToken({
      idToken: token(claims), rawNonce, allowedAudiences: ["com.orcwood.familychores"],
      fetcher: appleJwksFetch(), now,
    })).rejects.toThrow(expectedError);
  });
});
