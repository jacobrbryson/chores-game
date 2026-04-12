import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ProfilePageClient } from "@/components/profile-page-client";
import {
  getAuthenticatedSessionIdentity,
  isSessionSwitched,
  parseSessionToken,
} from "@/lib/auth/session";

export default async function ProfilePage() {
  const cookieStore = await cookies();
  const sessionUser = parseSessionToken(cookieStore.get("session_user")?.value);

  if (!sessionUser) {
    redirect("/");
  }

  const authenticatedIdentity = getAuthenticatedSessionIdentity(sessionUser);

  return (
    <ProfilePageClient
      name={sessionUser.name || ""}
      email={sessionUser.email || ""}
      role={sessionUser.role}
      picture={sessionUser.picture || ""}
      isSwitched={isSessionSwitched(sessionUser)}
      authenticatedName={authenticatedIdentity.name || authenticatedIdentity.email || ""}
    />
  );
}
