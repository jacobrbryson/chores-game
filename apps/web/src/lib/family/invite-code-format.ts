/**
 * Client-safe invite-code formatting.
 *
 * Kept separate from `invite-tokens.ts` because that module imports
 * `node:crypto` for code generation and hashing, which must never reach a
 * browser bundle. Everything here is pure string handling shared by the web
 * join form, the mobile join screen, and the server.
 */

/** Crockford base32: no I, L, O or U, so spoken/typed codes stay unambiguous. */
export const INVITE_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const INVITE_CODE_LENGTH = 12;

/**
 * Accepts what a human actually types: lower case, spaces, dashes, and the
 * characters Crockford base32 deliberately excludes because they look like
 * digits (I/L read as 1, O reads as 0).
 */
export function normalizeFamilyInviteCode(value: string | undefined | null) {
  return (value ?? "")
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
}

export function isValidFamilyInviteCodeShape(value: string | undefined | null) {
  const normalized = normalizeFamilyInviteCode(value);
  if (normalized.length !== INVITE_CODE_LENGTH) return false;
  return [...normalized].every((character) => INVITE_CODE_ALPHABET.includes(character));
}

/** Display form: `XXXX-XXXX-XXXX`, which is easier to read aloud and re-type. */
export function formatFamilyInviteCode(value: string) {
  const normalized = normalizeFamilyInviteCode(value);
  return (normalized.match(/.{1,4}/g) ?? []).join("-");
}

/** The link form of the same credential. */
export function buildFamilyInviteUrl(code: string, appUrl?: string) {
  const base = (appUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const path = `/join?code=${encodeURIComponent(normalizeFamilyInviteCode(code))}`;
  return base ? `${base}${path}` : path;
}
