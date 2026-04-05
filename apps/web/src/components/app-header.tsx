import { cookies } from "next/headers";
import Link from "next/link";
import Image from "next/image";
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
        <Link href="/" className="brand brand-link">
          <Image
            src="/icons/web-app-manifest-192x192.png"
            alt=""
            width={36}
            height={36}
            className="brand-icon"
            priority
          />
          <span className="brand-copy">
            <span className="brand-title">Family Chores</span>
            <span className="brand-tagline">Play. Help. Earn.</span>
          </span>
        </Link>
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
