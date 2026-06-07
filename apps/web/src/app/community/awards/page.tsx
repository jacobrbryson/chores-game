import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CommunityAwardsPageClient } from "@/components/community-awards-page-client";
import { parseSessionToken } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function CommunityAwardsPage() {
  const cookieStore = await cookies();
  const sessionUser = parseSessionToken(cookieStore.get("session_user")?.value);

  if (!sessionUser) {
    redirect("/");
  }

  return <CommunityAwardsPageClient />;
}
