import { cookies } from "next/headers";
import { AppBrand } from "@/components/app-brand";
import { GoogleSignInButton } from "@/components/google-signin-button";
import { HeaderStoreLink } from "@/components/header-store-link";
import { ProfileMenu } from "@/components/profile-menu";
import { parseSessionToken } from "@/lib/auth/session";

export async function AppHeader() {
  const googleClientId =
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  const gsiLoginUri = appUrl ? `${appUrl}/api/auth/google/gsi` : undefined;
  const cookieStore = await cookies();
  const sessionUser = parseSessionToken(cookieStore.get("session_user")?.value);
  const profileInitial =
    sessionUser?.name?.trim().charAt(0).toUpperCase() ||
    sessionUser?.email?.trim().charAt(0).toUpperCase() ||
    "U";

  return (
    <nav className="top-nav panel">
      <div className="top-nav-brand-row">
        <AppBrand />
      </div>
      <div className={`nav-links ${sessionUser ? "nav-links-auth" : "nav-links-guest"}`}>
        {sessionUser ? (
          <>
            <HeaderStoreLink visible />
            <ProfileMenu
              name={sessionUser.name || ""}
              email={sessionUser.email}
              picture={sessionUser.picture}
              initial={profileInitial}
            />
          </>
        ) : googleClientId && gsiLoginUri ? (
          <GoogleSignInButton mode="gsi" clientId={googleClientId} loginUri={gsiLoginUri} />
        ) : (
          <p className="small nav-config-note">
            Google sign-in is not configured. Set `NEXT_PUBLIC_APP_URL` and Google client IDs.
          </p>
        )}
      </div>
    </nav>
  );
}
