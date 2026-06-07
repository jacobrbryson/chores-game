import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Alert } from "@/components/alert";
import { QuestsLibraryClient } from "@/app/features/quests/quests-library-client";
import { DiscoverySeenOnMount } from "@/components/discovery-seen-on-mount";
import { parseSessionToken } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Quests",
  description: "Interactive choose-your-own-adventure quest library.",
};

export default async function QuestsPage() {
  const cookieStore = await cookies();
  const sessionUser = parseSessionToken(cookieStore.get("session_user")?.value);

  if (!sessionUser) {
    redirect("/");
  }
  return (
    <main className="family-page quests-coming-soon-page quests-netflix-page">
      <DiscoverySeenOnMount sections={["quests"]} />
      <div className="quests-coming-soon-content-wrap">
        <Alert tone="info" align="center" showIcon={false} className="quests-coming-soon-intro-alert">
          <div className="small">
            <p>
              Choose your next adventure. Start with the featured quest, then unlock the full quest pack.
            </p>
          </div>
        </Alert>
        <QuestsLibraryClient />
      </div>
    </main>
  );
}
