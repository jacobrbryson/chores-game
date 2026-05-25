"use client";

import { useEffect, useState } from "react";
import { AppBrand } from "@/components/app-brand";
import { DashboardTabs } from "@/components/dashboard-tabs";
import { GoogleSignInButton } from "@/components/google-signin-button";
import { ProfileMenu } from "@/components/profile-menu";

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
  const [isCondensed, setIsCondensed] = useState(false);

  useEffect(() => {
    function updateCondensed() {
      const nextScrollY = window.scrollY;
      setIsCondensed((current) => {
        if (current) {
          return nextScrollY > 36;
        }
        return nextScrollY > 56;
      });
    }

    updateCondensed();
    window.addEventListener("scroll", updateCondensed, { passive: true });
    return () => window.removeEventListener("scroll", updateCondensed);
  }, []);

  return (
    <header className={`app-header ${sessionUser ? "app-header-auth" : "app-header-guest"}`}>
      <nav
        className={`top-nav panel ${sessionUser ? "top-nav-auth" : "top-nav-guest"}${
          isCondensed ? " top-nav-condensed" : ""
        }`}>
        <div className="top-nav-brand-row">
          <AppBrand />
        </div>
        <div className="top-nav-controls">
          <DashboardTabs visible={Boolean(sessionUser)} />
          <div className={`nav-links ${sessionUser ? "nav-links-auth" : "nav-links-guest"}`}>
            {sessionUser ? (
              <ProfileMenu
                name={sessionUser.name || ""}
                email={sessionUser.email}
                picture={sessionUser.picture}
                initial={profileInitial}
                isSwitched={isSwitched}
                authenticatedName={authenticatedName}
                showSupportLink={showSupportLink}
              />
            ) : googleClientId && gsiLoginUri ? (
              <GoogleSignInButton mode="gsi" clientId={googleClientId} loginUri={gsiLoginUri} />
            ) : (
              <p className="small nav-config-note">
                Google sign-in is not configured. Set `NEXT_PUBLIC_APP_URL` and Google client IDs.
              </p>
            )}
          </div>
        </div>
      </nav>
    </header>
  );
}
