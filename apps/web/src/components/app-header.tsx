import { cookies } from "next/headers";
import { AppHeaderShell } from "@/components/app-header-shell";
import {
  getAuthenticatedSessionIdentity,
  isKioskActive,
  isSessionSwitched,
  parseSessionToken,
} from "@/lib/auth/session";
import { hasSupportAdminEmail } from "@/lib/support/access";

export async function AppHeader() {
  const googleClientId =
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  const gsiLoginUri = appUrl ? `${appUrl}/api/auth/google/gsi` : undefined;
  const cookieStore = await cookies();
  const sessionUser = parseSessionToken(cookieStore.get("session_user")?.value);
  const authenticatedIdentity = sessionUser
    ? getAuthenticatedSessionIdentity(sessionUser)
    : null;
  const profileInitial =
    sessionUser?.name?.trim().charAt(0).toUpperCase() ||
    sessionUser?.email?.trim().charAt(0).toUpperCase() ||
    "U";

  return (
    <AppHeaderShell
      googleClientId={googleClientId}
      gsiLoginUri={gsiLoginUri}
      sessionUser={
        sessionUser
          ? {
              name: sessionUser.name || "",
              email: sessionUser.email,
              picture: sessionUser.picture,
            }
          : null
      }
      profileInitial={profileInitial}
      authenticatedName={authenticatedIdentity?.name || authenticatedIdentity?.email || ""}
      isSwitched={sessionUser ? isSessionSwitched(sessionUser) : false}
      showSupportLink={sessionUser ? hasSupportAdminEmail(sessionUser) : false}
      kioskActive={sessionUser ? isKioskActive(sessionUser) : false}
    />
  );
}
