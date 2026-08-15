import { cookies } from "next/headers";
import { AppHeaderShell } from "@/components/app-header-shell";
import {
  getAuthenticatedSessionIdentity,
  isKioskActive,
  isSessionSwitched,
  parseSessionToken,
} from "@/lib/auth/session";
import { hasSupportAdminEmail } from "@/lib/support/access";
import { createTranslator, DEFAULT_LOCALE } from "@packages/locales";

export async function AppHeader() {
  const googleClientId =
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  const gsiLoginUri = appUrl ? `${appUrl}/api/auth/google/gsi` : undefined;
  const appleClientId = process.env.NEXT_PUBLIC_APPLE_SERVICES_ID ?? process.env.APPLE_SERVICES_ID;
  const appleRedirectUri = appUrl ? `${appUrl}/` : undefined;
  const cookieStore = await cookies();
  const sessionUser = parseSessionToken(cookieStore.get("session_user")?.value);
  const authenticatedIdentity = sessionUser
    ? getAuthenticatedSessionIdentity(sessionUser)
    : null;
  const profileInitial =
    sessionUser?.name?.trim().charAt(0).toUpperCase() ||
    sessionUser?.email?.trim().charAt(0).toUpperCase() ||
    "U";
  const t = createTranslator({ locale: sessionUser?.locale ?? DEFAULT_LOCALE });

  return (
    <AppHeaderShell
      googleClientId={googleClientId}
      gsiLoginUri={gsiLoginUri}
      appleClientId={appleClientId}
      appleRedirectUri={appleRedirectUri}
      appleLabel={t("auth.signInWithApple")}
      applePendingLabel={t("auth.signingInWithApple")}
      appleFailedMessage={t("auth.appleSignInFailed")}
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
