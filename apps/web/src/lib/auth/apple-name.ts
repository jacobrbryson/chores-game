export type AppleNameInput = {
  firstName?: unknown;
  lastName?: unknown;
  givenName?: unknown;
  familyName?: unknown;
};

export function formatAppleDisplayName(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const input = value as AppleNameInput;
  const first = typeof input.firstName === "string"
    ? input.firstName
    : typeof input.givenName === "string" ? input.givenName : "";
  const last = typeof input.lastName === "string"
    ? input.lastName
    : typeof input.familyName === "string" ? input.familyName : "";
  return `${first.trim()} ${last.trim()}`.trim().slice(0, 120);
}
