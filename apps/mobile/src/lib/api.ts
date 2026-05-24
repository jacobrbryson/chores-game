import { createApiClient } from "@packages/api-client";

const baseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3000/api/v1";
export const appBaseUrl = baseUrl.replace(/\/api\/v1\/?$/, "");

export const apiClient = createApiClient({
  baseUrl,
  getAccessToken: async () => null,
  fetchImpl: (input, init) => fetch(input, { ...init, credentials: "include" }),
});

export async function apiFetch(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(json?.error?.code ?? json?.error ?? `HTTP_${response.status}`));
  }
  return json?.ok ? json.data : json;
}

export async function signInWithGoogleIdToken(idToken: string) {
  const response = await fetch(`${appBaseUrl}/api/auth/google/mobile`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json?.ok) {
    throw new Error(String(json?.error ?? "mobile_google_auth_failed"));
  }
  return json.data;
}
