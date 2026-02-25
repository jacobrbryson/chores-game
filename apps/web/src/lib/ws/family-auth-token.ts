import { createHmac } from "node:crypto";

type FamilySocketClaims = {
  uid: string;
  familyIds: string[];
  exp: number;
};

function getWsSecret() {
  const isProduction = process.env.NODE_ENV === "production";
  const secret = (
    process.env.WS_INTERNAL_SECRET ?? (isProduction ? "" : "dev-ws-internal-secret")
  ).trim();
  return secret || null;
}

function sign(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function createFamilySocketAuthToken(input: { uid: string; familyIds: string[] }) {
  const secret = getWsSecret();
  if (!secret) {
    return "";
  }
  const uniqueFamilyIds = Array.from(
    new Set(input.familyIds.map((entry) => entry.trim()).filter((entry) => entry.length > 0)),
  ).sort();
  if (!input.uid || uniqueFamilyIds.length === 0) {
    return "";
  }
  const claims: FamilySocketClaims = {
    uid: input.uid,
    familyIds: uniqueFamilyIds,
    exp: Math.floor(Date.now() / 1000) + 60 * 30,
  };
  const encodedClaims = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = sign(encodedClaims, secret);
  return `${encodedClaims}.${signature}`;
}

