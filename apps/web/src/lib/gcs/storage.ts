import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";

type ServiceAccount = {
  client_email?: string;
  private_key?: string;
};

const STORAGE_SCOPE = "https://www.googleapis.com/auth/devstorage.read_write";

let cachedToken: { token: string; expiresAtMillis: number } | null = null;

function encodeBase64Url(input: string) {
  return Buffer.from(input).toString("base64url");
}

function bucketName(overrideBucket?: string) {
  const bucket = overrideBucket?.trim() || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim();
  if (!bucket) {
    throw new Error("FIREBASE_STORAGE_BUCKET_MISSING");
  }
  return bucket;
}

async function readServiceAccount() {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim();
  if (rawJson) {
    return JSON.parse(rawJson) as ServiceAccount;
  }

  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (credentialsPath) {
    return JSON.parse(await readFile(credentialsPath, "utf8")) as ServiceAccount;
  }

  return null;
}

async function fetchMetadataToken() {
  const response = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    {
      headers: { "Metadata-Flavor": "Google" },
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new Error(`GCS_METADATA_TOKEN_HTTP_${response.status}`);
  }
  const payload = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!payload.access_token) {
    throw new Error("GCS_METADATA_TOKEN_MISSING");
  }
  return {
    token: payload.access_token,
    expiresAtMillis: Date.now() + Math.max(60, payload.expires_in ?? 300) * 1000,
  };
}

async function fetchServiceAccountToken(account: ServiceAccount) {
  if (!account.client_email || !account.private_key) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY_INVALID");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const assertionHeader = encodeBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const assertionPayload = encodeBase64Url(
    JSON.stringify({
      iss: account.client_email,
      scope: STORAGE_SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      exp: nowSeconds + 3600,
      iat: nowSeconds,
    }),
  );
  const unsignedJwt = `${assertionHeader}.${assertionPayload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsignedJwt);
  signer.end();

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsignedJwt}.${signer.sign(account.private_key).toString("base64url")}`,
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`GCS_SERVICE_ACCOUNT_TOKEN_HTTP_${response.status}`);
  }
  const payload = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!payload.access_token) {
    throw new Error("GCS_SERVICE_ACCOUNT_TOKEN_MISSING");
  }
  return {
    token: payload.access_token,
    expiresAtMillis: Date.now() + Math.max(60, payload.expires_in ?? 3600) * 1000,
  };
}

async function getStorageAccessToken() {
  if (cachedToken && cachedToken.expiresAtMillis - Date.now() > 60_000) {
    return cachedToken.token;
  }
  const serviceAccount = await readServiceAccount();
  cachedToken = serviceAccount
    ? await fetchServiceAccountToken(serviceAccount)
    : await fetchMetadataToken();
  return cachedToken.token;
}

export function gcsPublicUrl(objectPath: string) {
  const baseUrl = process.env.NEXT_PUBLIC_GCS_ASSET_BASE_URL?.replace(/\/+$/, "");
  if (baseUrl) {
    return `${baseUrl}/${objectPath.replace(/^\/+/, "")}`;
  }
  return `https://storage.googleapis.com/${bucketName()}/${objectPath.replace(/^\/+/, "")}`;
}

export async function uploadGcsObject(
  objectPath: string,
  body: Buffer,
  contentType = "application/octet-stream",
  options?: { bucket?: string },
) {
  const token = await getStorageAccessToken();
  const bucket = encodeURIComponent(bucketName(options?.bucket));
  const name = encodeURIComponent(objectPath.replace(/^\/+/, ""));
  const uploadBody = new Uint8Array(body).buffer as ArrayBuffer;
  const response = await fetch(
    `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${name}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": contentType,
      },
      body: uploadBody,
      cache: "no-store",
    },
  );

  if (!response.ok) {
    let detail = "";
    try {
      const json = (await response.json()) as { error?: { message?: string } };
      detail = json.error?.message ?? "";
    } catch {
      detail = await response.text();
    }
    throw new Error(`GCS_UPLOAD_HTTP_${response.status}${detail ? `_${detail}` : ""}`);
  }

  return {
    objectPath,
    publicUrl: gcsPublicUrl(objectPath),
  };
}

export async function uploadGcsJson(objectPath: string, value: unknown) {
  return uploadGcsObject(
    objectPath,
    Buffer.from(JSON.stringify(value, null, 2), "utf8"),
    "application/json; charset=utf-8",
  );
}

export async function uploadGcsJsonToBucket(bucket: string, objectPath: string, value: unknown) {
  return uploadGcsObject(
    objectPath,
    Buffer.from(JSON.stringify(value, null, 2), "utf8"),
    "application/json; charset=utf-8",
    { bucket },
  );
}

export async function readGcsObjectText(objectPath: string) {
  const token = await getStorageAccessToken();
  const bucket = encodeURIComponent(bucketName());
  const name = encodeURIComponent(objectPath.replace(/^\/+/, ""));
  const response = await fetch(`https://storage.googleapis.com/storage/v1/b/${bucket}/o/${name}?alt=media`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    let detail = "";
    try {
      const json = (await response.json()) as { error?: { message?: string } };
      detail = json.error?.message ?? "";
    } catch {
      detail = await response.text();
    }
    throw new Error(`GCS_READ_HTTP_${response.status}${detail ? `_${detail}` : ""}`);
  }

  return response.text();
}

export async function readGcsJson(objectPath: string) {
  return JSON.parse(await readGcsObjectText(objectPath)) as unknown;
}
