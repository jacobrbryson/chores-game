import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function getPushEncryptionKey() {
  const source = process.env.PUSH_SUBSCRIPTION_SECRET || process.env.SESSION_SECRET || "";
  if (source.trim().length < 16) {
    throw new Error("PUSH_ENCRYPTION_SECRET_MISSING");
  }
  return createHash("sha256").update(source).digest();
}

export function encryptPushSubscriptionPayload(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getPushEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptPushSubscriptionPayload(value: string) {
  const [ivEncoded, tagEncoded, payloadEncoded] = value.split(".");
  if (!ivEncoded || !tagEncoded || !payloadEncoded) {
    throw new Error("PUSH_SUBSCRIPTION_CIPHERTEXT_INVALID");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getPushEncryptionKey(),
    Buffer.from(ivEncoded, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payloadEncoded, "base64url")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
