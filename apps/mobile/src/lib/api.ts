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

export type MobileStoreSummary = {
  balance: number;
  avatarUrl: string;
};

export type MobileFamilyMember = {
  id: string;
  uid?: string;
  name: string;
  email?: string;
  role: "admin" | "player";
  status: "active" | "invited";
  dashboardPrimaryColor?: string;
  avatarId?: string;
  avatarPhotoUrl?: string;
  stats?: {
    currentCoins?: number;
  };
};

export type MobileFamilyChore = {
  id: string;
  title: string;
  status: string;
  sortOrder?: number;
  assigneeId?: string;
  assigneeIds?: string[];
  assigneeScope?: "single" | "multiple" | "family";
  assigneeName?: string;
  assigneePrimaryColor?: string;
  assigneeAvatarId?: string;
  assigneeAvatarPhotoUrl?: string;
  categories?: Array<{ id: string; name: string; color: string }>;
  coinValue?: number;
  requireApproval?: boolean;
  choreType?: string;
  createdAt?: string;
};

export type MobileFamilySummary = {
  viewerUid: string;
  viewerAssigneeAliases?: string[];
  noFamily: boolean;
  family: null | { id: string; name: string };
  members: MobileFamilyMember[];
  choresToday: MobileFamilyChore[];
};

export async function fetchMobileStoreSummary(): Promise<MobileStoreSummary> {
  const response = await fetch(`${appBaseUrl}/api/store`, {
    credentials: "include",
    cache: "no-store",
  });
  const summary = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(summary?.error ?? `store_summary_failed_${response.status}`));
  }

  const avatarPhotoUrl = typeof summary?.avatarPhotoUrl === "string" ? summary.avatarPhotoUrl.trim() : "";
  const avatarId = typeof summary?.avatarId === "string" ? summary.avatarId.trim() : "";
  const googlePhotoUrl = typeof summary?.googlePhotoUrl === "string" ? summary.googlePhotoUrl.trim() : "";

  return {
    balance: typeof summary?.balance === "number" ? Math.max(0, summary.balance) : 0,
    avatarUrl: (avatarId ? `${appBaseUrl}/avatars/default/${encodeURIComponent(avatarId)}` : "") || avatarPhotoUrl || googlePhotoUrl,
  };
}

export async function fetchMobileFamilySummary(): Promise<MobileFamilySummary> {
  const summary = await apiClient.families.getCurrent() as MobileFamilySummary;
  return {
    viewerUid: typeof summary.viewerUid === "string" ? summary.viewerUid : "",
    viewerAssigneeAliases: Array.isArray(summary.viewerAssigneeAliases) ? summary.viewerAssigneeAliases : [],
    noFamily: Boolean(summary.noFamily),
    family: summary.family ?? null,
    members: Array.isArray(summary.members) ? summary.members : [],
    choresToday: Array.isArray(summary.choresToday) ? summary.choresToday : [],
  };
}

export async function patchMobileChore(choreId: string, body: Record<string, unknown>) {
  const response = await fetch(`${appBaseUrl}/api/chores/${encodeURIComponent(choreId)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(json?.error ?? `patch_chore_failed_${response.status}`));
  }
  return json;
}

export async function deleteMobileChore(choreId: string) {
  const response = await fetch(`${appBaseUrl}/api/chores/${encodeURIComponent(choreId)}`, {
    method: "DELETE",
    credentials: "include",
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(json?.error ?? `delete_chore_failed_${response.status}`));
  }
  return json;
}

export async function reorderMobileChores(orderedChoreIds: string[]) {
  const response = await fetch(`${appBaseUrl}/api/chores`, {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "reorder", orderedChoreIds }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(json?.error ?? `reorder_chores_failed_${response.status}`));
  }
  return json;
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
