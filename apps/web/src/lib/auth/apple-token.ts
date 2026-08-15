import { createHash, createPublicKey, timingSafeEqual, verify } from "node:crypto";

const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_JWKS_URL = `${APPLE_ISSUER}/auth/keys`;
const DEFAULT_JWKS_TTL_MS = 6 * 60 * 60 * 1000;

type AppleJwk = import("node:crypto").webcrypto.JsonWebKey & {
  kid?: string;
  alg?: string;
  kty?: string;
};
type AppleClaims = {
  aud?: string | string[];
  email?: string;
  exp?: number;
  iss?: string;
  nonce?: string;
  sub?: string;
};

let jwksCache: { expiresAt: number; keys: AppleJwk[] } | null = null;

function decodeJson<T>(segment: string): T {
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as T;
  } catch {
    throw new Error("APPLE_TOKEN_MALFORMED");
  }
}

function getCacheTtl(response: Response) {
  const match = response.headers.get("cache-control")?.match(/max-age=(\d+)/i);
  return match ? Math.max(60_000, Number(match[1]) * 1000) : DEFAULT_JWKS_TTL_MS;
}

async function getAppleKeys(fetcher: typeof fetch, nowMs: number, forceRefresh = false) {
  if (!forceRefresh && jwksCache && jwksCache.expiresAt > nowMs) return jwksCache.keys;
  const response = await fetcher(APPLE_JWKS_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`APPLE_JWKS_HTTP_${response.status}`);
  const payload = (await response.json()) as { keys?: AppleJwk[] };
  const keys = Array.isArray(payload.keys) ? payload.keys : [];
  if (keys.length === 0) throw new Error("APPLE_JWKS_EMPTY");
  jwksCache = { keys, expiresAt: nowMs + getCacheTtl(response) };
  return keys;
}

export function getAllowedAppleAudiences() {
  return [
    process.env.APPLE_SERVICES_ID,
    process.env.NEXT_PUBLIC_APPLE_SERVICES_ID,
    process.env.APPLE_IOS_BUNDLE_ID,
  ]
    .map((value) => value?.trim() ?? "")
    .filter((value, index, values) =>
      value.length > 0 && value !== "*" && values.indexOf(value) === index,
    );
}

export async function verifyAppleIdentityToken(input: {
  idToken: string;
  rawNonce: string;
  allowedAudiences?: string[];
  fetcher?: typeof fetch;
  now?: Date;
}) {
  const segments = input.idToken.split(".");
  if (segments.length !== 3) throw new Error("APPLE_TOKEN_MALFORMED");
  const [encodedHeader, encodedClaims, encodedSignature] = segments;
  const header = decodeJson<{ alg?: string; kid?: string }>(encodedHeader);
  const claims = decodeJson<AppleClaims>(encodedClaims);
  if (header.alg !== "RS256" || !header.kid) throw new Error("APPLE_TOKEN_ALGORITHM_INVALID");

  const nowMs = (input.now ?? new Date()).getTime();
  const fetcher = input.fetcher ?? fetch;
  let keys = await getAppleKeys(fetcher, nowMs);
  let jwk = keys.find((key) => key.kid === header.kid && key.kty === "RSA");
  if (!jwk) {
    keys = await getAppleKeys(fetcher, nowMs, true);
    jwk = keys.find((key) => key.kid === header.kid && key.kty === "RSA");
  }
  if (!jwk) throw new Error("APPLE_SIGNING_KEY_NOT_FOUND");
  const signatureValid = verify(
    "RSA-SHA256",
    Buffer.from(`${encodedHeader}.${encodedClaims}`),
    createPublicKey(
      { key: jwk, format: "jwk" } as Parameters<typeof createPublicKey>[0],
    ),
    Buffer.from(encodedSignature, "base64url"),
  );
  if (!signatureValid) throw new Error("APPLE_SIGNATURE_INVALID");
  if (claims.iss !== APPLE_ISSUER) throw new Error("APPLE_ISSUER_MISMATCH");

  const allowedAudiences = input.allowedAudiences ?? getAllowedAppleAudiences();
  if (allowedAudiences.length === 0) throw new Error("APPLE_AUDIENCE_MISSING");
  const tokenAudiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud ?? ""];
  if (!tokenAudiences.some((audience) => allowedAudiences.includes(audience))) {
    throw new Error("APPLE_AUDIENCE_MISMATCH");
  }
  if (typeof claims.exp !== "number" || claims.exp <= Math.floor(nowMs / 1000)) {
    throw new Error("APPLE_TOKEN_EXPIRED");
  }
  if (!claims.sub) throw new Error("APPLE_SUBJECT_MISSING");

  const expectedNonce = createHash("sha256").update(input.rawNonce).digest("hex");
  const actualNonce = claims.nonce ?? "";
  const expectedBuffer = Buffer.from(expectedNonce);
  const actualBuffer = Buffer.from(actualNonce);
  if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
    throw new Error("APPLE_NONCE_MISMATCH");
  }

  return {
    subject: claims.sub,
    email: typeof claims.email === "string" ? claims.email : undefined,
    audience: tokenAudiences[0],
  };
}

export function resetAppleJwksCacheForTests() {
  jwksCache = null;
}
