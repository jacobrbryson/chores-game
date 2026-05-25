import { createApiClient } from "@packages/api-client";
import { Platform } from "react-native";

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

export async function signOut() {
  const response = await fetch(`${appBaseUrl}/api/auth/logout`, {
    method: "POST",
    credentials: "include",
    redirect: "manual",
  });
  if (response.status >= 400) {
    throw new Error(`logout_failed_${response.status}`);
  }
  if (Platform.OS !== "web") {
    try {
      const { GoogleSignin } = require("@react-native-google-signin/google-signin");
      await GoogleSignin.signOut();
    } catch (error) {
      console.warn("[MOBILE_GOOGLE_SIGNOUT_WARNING]", error);
    }
  }
}
