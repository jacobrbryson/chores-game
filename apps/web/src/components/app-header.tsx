import { cookies } from "next/headers";
import Link from "next/link";
import Script from "next/script";
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
    <>
      {!sessionUser && googleClientId && gsiLoginUri ? (
        <Script src="https://accounts.google.com/gsi/client" async defer />
      ) : null}
      <nav className="top-nav panel">
        <Link href="/" className="brand brand-link">
          Family Chores
        </Link>
        <div className="nav-links">
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
            <>
              <div
                id="g_id_onload"
                data-client_id={googleClientId}
                data-context="signin"
                data-auto_prompt="false"
                data-ux_mode="redirect"
                data-login_uri={gsiLoginUri}
                data-auto_select="false"
                data-itp_support="true"
                data-use_fedcm_for_prompt="false"
                data-use_fedcm_for_button="false"
              />
              <div
                className="g_id_signin"
                data-type="standard"
                data-shape="rectangular"
                data-theme="outline"
                data-text="signin_with"
                data-size="large"
                data-logo_alignment="left"
              />
            </>
          ) : (
            <p className="small">
              Google sign-in is not configured. Set `NEXT_PUBLIC_APP_URL` and Google client IDs.
            </p>
          )}
        </div>
      </nav>
    </>
  );
}
