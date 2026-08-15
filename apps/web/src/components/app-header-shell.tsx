"use client";

import { AppBrand } from "@/components/app-brand";
import { GoogleSignInButton } from "@/components/google-signin-button";
import { AppleSignInButton } from "@/components/apple-signin-button";
import { MainNavigation } from "@/components/main-navigation";

type AppHeaderShellProps = {
  googleClientId?: string;
  gsiLoginUri?: string;
  appleClientId?: string;
  appleRedirectUri?: string;
  appleLabel: string;
  applePendingLabel: string;
  appleFailedMessage: string;
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
  kioskActive?: boolean;
};

export function AppHeaderShell({
  googleClientId,
  gsiLoginUri,
  appleClientId,
  appleRedirectUri,
  appleLabel,
  applePendingLabel,
  appleFailedMessage,
  sessionUser,
  profileInitial,
  authenticatedName,
  isSwitched,
  showSupportLink,
  kioskActive = false,
}: AppHeaderShellProps) {
  // Kiosk Mode is a focused shared-tablet experience: never expose the primary
  // navigation or profile menu (which would surface family settings, support,
  // switching and logout). The kiosk page renders its own minimal header with
  // PIN-gated Switch Player / Exit controls.
  if (sessionUser && kioskActive) {
    return (
      <header className="app-header app-header-auth app-header-kiosk">
        <div className="top-nav panel top-nav-auth top-nav-kiosk">
          <AppBrand />
        </div>
      </header>
    );
  }

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
          <div className="top-nav-guest-layout">
            <div className="top-nav-brand-row">
              <AppBrand />
            </div>
            <div className="nav-links nav-links-guest">
              {googleClientId && gsiLoginUri ? (
                <GoogleSignInButton
                  mode="gsi"
                  clientId={googleClientId}
                  loginUri={gsiLoginUri}
                  width={200}
                  wrapperClassName="google-signin-wrap nav-google-signin"
                />
              ) : (
                <p className="small nav-config-note">
                  Google sign-in is not configured. Set `NEXT_PUBLIC_APP_URL` and Google client IDs.
                </p>
              )}
              {appleClientId && appleRedirectUri ? (
                <AppleSignInButton
                  clientId={appleClientId}
                  redirectUri={appleRedirectUri}
                  label={appleLabel}
                  pendingLabel={applePendingLabel}
                  failedMessage={appleFailedMessage}
                  className="nav-apple-signin"
                />
              ) : null}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
