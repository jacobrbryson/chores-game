"use client";

import { GoogleSignInButton } from "@/components/google-signin-button";
import { MainNavigation } from "@/components/main-navigation";

type AppHeaderShellProps = {
  googleClientId?: string;
  gsiLoginUri?: string;
  sessionUser:
    | {
        name: string;
        email: string;
        picture?: string;
      }
    | null;
  profileInitial: string;
  authenticatedName: string;
  isSwitched: boolean;
  showSupportLink: boolean;
};

export function AppHeaderShell({
  googleClientId,
  gsiLoginUri,
  sessionUser,
  profileInitial,
  authenticatedName,
  isSwitched,
  showSupportLink,
}: AppHeaderShellProps) {
  return (
    <header className={`app-header ${sessionUser ? "app-header-auth" : "app-header-guest"}`}>
      <div className={`top-nav panel ${sessionUser ? "top-nav-auth" : "top-nav-guest"}`}>
        {sessionUser ? (
          <MainNavigation
            sessionUser={sessionUser}
            profileInitial={profileInitial}
            authenticatedName={authenticatedName}
            isSwitched={isSwitched}
            showSupportLink={showSupportLink}
          />
        ) : (
          <div className="nav-links nav-links-guest">
            {googleClientId && gsiLoginUri ? (
              <GoogleSignInButton mode="gsi" clientId={googleClientId} loginUri={gsiLoginUri} />
            ) : (
              <p className="small nav-config-note">
                Google sign-in is not configured. Set `NEXT_PUBLIC_APP_URL` and Google client IDs.
              </p>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
