import type { SessionUser } from "@/lib/auth/session";

function parseList(value: string | undefined) {
  return new Set(
    (value ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isSupportAdmin(session: SessionUser | null) {
  if (!session?.uid) {
    return false;
  }

  const allowedEmails = parseList(process.env.SUPPORT_ADMIN_EMAILS);
  const allowedUids = parseList(process.env.SUPPORT_ADMIN_UIDS);
  const email = session.email.trim().toLowerCase();
  const authEmail = (session.authEmail ?? "").trim().toLowerCase();
  const uid = session.uid.trim().toLowerCase();
  const authUid = (session.authUid ?? "").trim().toLowerCase();

  return (
    (email && allowedEmails.has(email)) ||
    (authEmail && allowedEmails.has(authEmail)) ||
    (uid && allowedUids.has(uid)) ||
    (authUid && allowedUids.has(authUid))
  );
}

export function hasSupportAdminEmail(session: SessionUser | null) {
  if (!session) {
    return false;
  }

  const allowedEmails = parseList(process.env.SUPPORT_ADMIN_EMAILS);
  const email = session.email.trim().toLowerCase();
  const authEmail = (session.authEmail ?? "").trim().toLowerCase();

  return Boolean((email && allowedEmails.has(email)) || (authEmail && allowedEmails.has(authEmail)));
}
