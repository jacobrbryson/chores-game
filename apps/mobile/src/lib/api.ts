import { createApiClient } from "@packages/api-client";

const baseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3000/api/v1";

export const apiClient = createApiClient({
  baseUrl,
  // TODO: Replace with secure token flow (Google/Firebase + secure storage).
  getAccessToken: async () => null,
});
