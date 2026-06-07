import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { AchievementsPageClient } from "@/components/achievements/achievements-page-client";
import { DiscoverySeenOnMount } from "@/components/discovery-seen-on-mount";
import { parseSessionToken } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Achievements",
  description: "Track chore game progress and unlock achievements.",
};

export default async function AchievementsPage() {
  const cookieStore = await cookies();
  const sessionUser = parseSessionToken(cookieStore.get("session_user")?.value);

  if (!sessionUser) {
    redirect("/");
  }

  return (
    <main className="family-page">
      <DiscoverySeenOnMount sections={["achievements"]} />
      <AchievementsPageClient />
    </main>
  );
}
